// 자동 매매 관리자
import 'dotenv/config'
import { KISApi } from './kis-api.js'
import { FMPApi } from './fmp-api.js'
import fs from 'fs'
import path from 'path'

interface Position {
  ticker: string
  quantity: number
  buyPrice: number
  currentPrice: number
  profitLoss: number
  profitLossPercent: number
  buyTime: string
}

interface TradingConfig {
  minPositiveScore: number // 최소 호재 점수
  stopLoss: number // 손절 비율 (%)
  takeProfit: number // 익절 비율 (%)
  maxPositionSize: number // 최대 포지션 크기 ($)
  enabled: boolean
  testMode: boolean // 테스트 모드 (실제 주문 안함)
}

interface PendingOrder {
  id: string
  ticker: string
  quantity: number
  price: number
  newsTitle: string
  createdAt: string
  reason: string // 'market_closed', 'weekend' 등
}

export class TradingManager {
  private kisApi: KISApi
  private fmpApi: FMPApi
  private positions: Position[] = []
  private config: TradingConfig
  private dataDir: string
  private positionsFile: string
  private tradingHistoryFile: string
  private pendingOrdersFile: string
  private isMonitoring: boolean = false
  private analyzedNewsIds: Set<string> = new Set() // 이미 분석한 뉴스 ID 추적
  private pendingOrders: PendingOrder[] = []
  private marketOpenCheckInterval: NodeJS.Timeout | null = null

  // 미국 주식 거래 시간 체크 (한국 시간 기준)
  private isMarketOpen(): boolean {
    const now = new Date()
    const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
    const hour = koreaTime.getHours()
    const minute = koreaTime.getMinutes()
    const day = koreaTime.getDay() // 0: 일요일, 6: 토요일
    
    // 주말 체크
    if (day === 0 || day === 6) {
      return false
    }
    
    // 미국 정규 장: 한국시간 23:30 ~ 06:00 (서머타임)
    // 또는 22:30 ~ 05:00 (동절기)
    // 현재는 서머타임 기준으로 구현
    const totalMinutes = hour * 60 + minute
    
    // 23:30 이후 (당일) 또는 06:00 이전 (다음날)
    if (totalMinutes >= 1410 || totalMinutes < 360) { // 1410 = 23시 30분, 360 = 6시
      return true
    }
    
    return false
  }

  constructor() {
    this.kisApi = new KISApi()
    this.fmpApi = new FMPApi()
    this.config = {
      minPositiveScore: 80, // 호재 점수 80점 이상 (수동매매 신호)
      stopLoss: -10, // -10% 손절
      takeProfit: 15, // +15% 익절
      maxPositionSize: 1000, // 최대 $1000
      enabled: true,
      testMode: process.env.TEST_MODE === 'true' // 환경변수로 제어 (기본: 실제 주문)
    }
    
    // Trading mode 로그 제거 (불필요)
    
    this.dataDir = path.join(process.cwd(), '..', 'data')
    this.positionsFile = path.join(this.dataDir, 'positions.json')
    this.tradingHistoryFile = path.join(this.dataDir, 'trading-history.json')
    this.pendingOrdersFile = path.join(this.dataDir, 'pending-orders.json')
    
    this.loadPositions()
    this.loadPendingOrders()
    
    // 장 시작 시 예약 주문 실행을 위한 모니터링 시작
    this.startMarketOpenMonitoring()
  }

  // KIS API 접근용 getter
  getKISApi(): KISApi {
    return this.kisApi
  }

  // 포지션 로드
  private loadPositions() {
    try {
      if (fs.existsSync(this.positionsFile)) {
        const data = fs.readFileSync(this.positionsFile, 'utf-8')
        this.positions = JSON.parse(data)
        console.log(`📂 Loaded ${this.positions.length} positions`)
      }
    } catch (error) {
      console.error('Error loading positions:', error)
      this.positions = []
    }
  }

  // 포지션 저장
  private savePositions() {
    try {
      fs.writeFileSync(this.positionsFile, JSON.stringify(this.positions, null, 2), 'utf-8')
    } catch (error) {
      console.error('Error saving positions:', error)
    }
  }

  // 거래 이력 로드
  private loadTradingHistory(): any[] {
    try {
      if (fs.existsSync(this.tradingHistoryFile)) {
        const data = fs.readFileSync(this.tradingHistoryFile, 'utf-8')
        return JSON.parse(data)
      }
      return []
    } catch (error) {
      console.error('Error loading trading history:', error)
      return []
    }
  }

  // 거래 이력 저장
  private saveTradingHistory(record: any) {
    try {
      let history: any[] = this.loadTradingHistory()
      
      history.unshift(record)
      
      // 최대 1000개만 유지
      if (history.length > 1000) {
        history = history.slice(0, 1000)
      }
      
      fs.writeFileSync(this.tradingHistoryFile, JSON.stringify(history, null, 2), 'utf-8')
    } catch (error) {
      console.error('Error saving trading history:', error)
    }
  }

  // 예약 주문 로드
  private loadPendingOrders() {
    try {
      if (fs.existsSync(this.pendingOrdersFile)) {
        const data = fs.readFileSync(this.pendingOrdersFile, 'utf-8')
        this.pendingOrders = JSON.parse(data)
        console.log(`📋 예약 주문 ${this.pendingOrders.length}개 로드됨`)
      }
    } catch (error) {
      console.error('예약 주문 로드 실패:', error)
      this.pendingOrders = []
    }
  }

  // 예약 주문 저장
  private savePendingOrders() {
    try {
      fs.writeFileSync(this.pendingOrdersFile, JSON.stringify(this.pendingOrders, null, 2), 'utf-8')
      console.log(`💾 예약 주문 ${this.pendingOrders.length}개 저장됨`)
    } catch (error) {
      console.error('예약 주문 저장 실패:', error)
    }
  }

  // 예약 주문 추가
  private addPendingOrder(ticker: string, quantity: number, price: number, newsTitle: string, reason: string) {
    const order: PendingOrder = {
      id: `${ticker}_${Date.now()}`,
      ticker,
      quantity,
      price,
      newsTitle,
      createdAt: new Date().toISOString(),
      reason
    }
    
    this.pendingOrders.push(order)
    this.savePendingOrders()
    
    console.log(`\n📌 예약 주문 등록:`)
    console.log(`   티커: ${ticker}`)
    console.log(`   수량: ${quantity}주`)
    console.log(`   가격: $${price}`)
    console.log(`   사유: ${reason}`)
    console.log(`   예약시간: ${order.createdAt}`)
    console.log(`   → 장 시작 시 자동 실행됩니다.\n`)
  }

  // 장 시작 모니터링
  private startMarketOpenMonitoring() {
    // 1분마다 장 시작 확인
    this.marketOpenCheckInterval = setInterval(async () => {
      if (this.isMarketOpen() && this.pendingOrders.length > 0) {
        console.log(`\n🔔 장이 열렸습니다! 예약 주문 ${this.pendingOrders.length}개 실행 중...`)
        await this.executePendingOrders()
      }
    }, 60000) // 1분
    
    console.log(`✓ 예약 주문 모니터링 시작 (1분마다 체크)`)
  }

  // 예약 주문 실행
  private async executePendingOrders() {
    const ordersToExecute = [...this.pendingOrders]
    this.pendingOrders = [] // 초기화
    
    for (const order of ordersToExecute) {
      try {
        console.log(`\n🚀 예약 주문 실행: ${order.ticker}`)
        
        // 현재가 재조회
        const currentPrice = await this.fmpApi.getCurrentPrice(order.ticker)
        if (!currentPrice) {
          console.log(`   ✗ 현재가 조회 실패, 건너뜀`)
          continue
        }
        
        // 매수 실행
        if (!this.config.testMode) {
          await this.kisApi.buyStock(order.ticker, order.quantity, currentPrice)
        }
        
        // 포지션 추가
        const position: Position = {
          ticker: order.ticker,
          quantity: order.quantity,
          buyPrice: currentPrice,
          currentPrice: currentPrice,
          profitLoss: 0,
          profitLossPercent: 0,
          buyTime: new Date().toISOString()
        }
        
        this.positions.push(position)
        this.savePositions()
        
        // 거래 이력 저장
        this.saveTradingHistory({
          type: 'buy',
          ticker: order.ticker,
          quantity: order.quantity,
          price: currentPrice,
          timestamp: new Date().toISOString(),
          reason: `예약 주문 실행 (${order.reason})`,
          newsTitle: order.newsTitle
        })
        
        console.log(`   ✓ 예약 주문 실행 완료: ${order.ticker} x ${order.quantity}주`)
      } catch (error: any) {
        console.error(`   ✗ 예약 주문 실행 실패:`, error.message)
        // 실패한 주문은 다시 추가하지 않음 (로그만 남김)
      }
    }
    
    this.savePendingOrders()
    console.log(`\n✅ 예약 주문 처리 완료\n`)
  }

  // 뉴스 분석 결과에 따른 자동 매수
  async analyzeAndTrade(newsItem: any): Promise<void> {
    // 이미 분석한 뉴스는 스킵 (중복 분석 방지)
    if (this.analyzedNewsIds.has(newsItem.id)) {
      return
    }
    
    console.log(`\n🔍 매매 분석 시작: ${newsItem.title?.substring(0, 50)}...`)
    
    // 분석 완료 표시 (분석 시작 시점에 추가하여 중복 방지)
    this.analyzedNewsIds.add(newsItem.id)
    
    // 최대 1000개만 추적 (메모리 관리)
    if (this.analyzedNewsIds.size > 1000) {
      const firstId = this.analyzedNewsIds.values().next().value
      if (firstId) {
        this.analyzedNewsIds.delete(firstId)
      }
    }
    
    if (!this.config.enabled) {
      console.log(`⏸️  자동매매 비활성화 상태`)
      return
    }

    // 장 시간 체크 - 장 마감 시 예약 주문 등록
    if (!this.isMarketOpen()) {
      console.log(`⏰ 장 시작 전 또는 장 마감 (한국시간 23:30~06:00만 거래 가능)`)
      
      // 호재 80% 이상이면 예약 주문 등록 (자동매매 90%, 수동매매 80% 모두 포함)
      const analysis = newsItem.analysis
      if (analysis?.isNasdaqListed && analysis.ticker && analysis.positivePercentage >= 80) {
        console.log(`\n📌 예약 주문 조건 충족: ${analysis.ticker} (호재 ${analysis.positivePercentage}%)`)
        
        const currentPrice = await this.fmpApi.getCurrentPrice(analysis.ticker)
        if (currentPrice) {
          console.log(`   현재가: $${currentPrice}`)
          
          const buyingPower = await this.kisApi.getBuyingPower(analysis.ticker)
          console.log(`   매수가능금액: $${buyingPower}`)
          
          const investmentAmount = buyingPower * 0.1
          const quantity = Math.floor(investmentAmount / currentPrice)
          
          if (quantity >= 1) {
            const now = new Date()
            const day = now.getDay()
            const reason = day === 0 || day === 6 ? '주말' : '장 마감'
            
            const orderType = analysis.positivePercentage >= 90 ? '자동매매' : '수동매매'
            
            this.addPendingOrder(
              analysis.ticker,
              quantity,
              currentPrice,
              newsItem.titleKo || newsItem.title,
              `${orderType} (호재 ${analysis.positivePercentage}%) - ${reason}`
            )
          } else {
            console.log(`   ✗ 수량 부족: ${quantity}주 (최소 1주 필요)`)
          }
        } else {
          console.log(`   ✗ 현재가 조회 실패`)
        }
      } else {
        if (!analysis?.isNasdaqListed) {
          console.log(`   → 나스닥 비상장`)
        } else if (!analysis?.ticker) {
          console.log(`   → 티커 없음`)
        } else if (analysis.positivePercentage < 80) {
          console.log(`   → 호재율 부족 (${analysis.positivePercentage}% < 80%)`)
        }
      }
      
      return
    }

    const analysis = newsItem.analysis
    
    // 분석 데이터 검증
    if (!analysis) {
      console.log(`❌ 분석 데이터 없음`)
      return
    }
    
    console.log(`📊 분석 결과:`)
    console.log(`   - 나스닥 상장: ${analysis.isNasdaqListed ? 'Y' : 'N'}`)
    console.log(`   - 티커: ${analysis.ticker || '없음'}`)
    console.log(`   - 호재 점수: ${analysis.positivePercentage}%`)
    console.log(`   - 악재 점수: ${analysis.negativePercentage}%`)
    
    if (!analysis.isNasdaqListed) {
      console.log(`⏭️  스킵: 나스닥 비상장 종목`)
      return
    }
    
    if (!analysis.ticker) {
      console.log(`⏭️  스킵: 티커 정보 없음`)
      return
    }

    // 호재 점수 확인 (80% 이상이어야 매매 고려)
    if (analysis.positivePercentage < 80) {
      console.log(`⏭️  스킵: 호재 점수 부족 (${analysis.positivePercentage}% < 80%)`)
      return
    }

    // 이미 보유 중인지 확인
    const existingPosition = this.positions.find(p => p.ticker === analysis.ticker)
    if (existingPosition) {
      console.log(`⏭️  스킵: ${analysis.ticker} 이미 보유 중`)
      return
    }

    try {
      // 현재가 조회 (FMP 우선, 실패시 KIS)
      let currentPrice = await this.fmpApi.getCurrentPrice(analysis.ticker)
      if (!currentPrice) {
        console.log(`   FMP 가격 조회 실패, KIS API 사용`)
        currentPrice = await this.kisApi.getOverseasPrice(analysis.ticker)
      } else {
        console.log(`   FMP 현재가: $${currentPrice}`)
      }
      
      // 현재가 조회 실패 시 스킵
      if (!currentPrice || isNaN(currentPrice)) {
        console.log(`❌ 현재가 조회 실패: ${analysis.ticker}`)
        return
      }
      
      // 90% 이상이면 자동매매, 80-89%면 수동매매 신호만
      if (analysis.positivePercentage >= 90) {
        // 자동매매 실행
        const mode = this.config.testMode ? '[테스트 모드]' : '[실제 거래]'
        console.log(`\n${'='.repeat(60)}`)
        console.log(`🚀 ${mode} 자동 매수 신호 감지! (호재 ${analysis.positivePercentage}%)`)
        console.log(`   티커: ${analysis.ticker}`)
        console.log(`   뉴스: ${newsItem.titleKo}`)
        console.log(`   매수 전략: 현 잔고의 10%`)
        
        // 매수 가능 금액 조회 (티커 전달)
        let buyingPower = await this.kisApi.getBuyingPower(analysis.ticker)
        if (buyingPower === 0) {
          console.log('   매수가능금액이 0이므로 외화잔고 조회 시도...')
          buyingPower = await this.kisApi.getForeignCurrencyBalance()
        }
        
        // 잔고가 없으면 매수 불가
        if (buyingPower === 0) {
          console.log(`❌ 매수 불가: 잔고 없음`)
          console.log(`${'='.repeat(60)}\n`)
          return
        }
        
        console.log(`💵 사용 가능 잔고: $${buyingPower.toFixed(2)}`)
        
        // 매수 금액 계산 (현 잔고의 10% 또는 최대 포지션 크기 중 작은 값)
        const orderAmount = Math.min(this.config.maxPositionSize, buyingPower * 0.10) // 현 잔고의 10%
        const quantity = Math.floor(orderAmount / currentPrice)
        
        if (quantity < 1) {
          console.log(`⚠️  매수 불가: 수량 부족 (가능 금액: $${buyingPower})`)
          console.log(`${'='.repeat(60)}\n`)
          return
        }

        // 매수 주문 (테스트 모드면 실제 주문 안함)
        const buyTime = new Date().toISOString()
        if (!this.config.testMode) {
          // 현재가를 전달하여 지정가 주문
          const orderResult = await this.kisApi.buyStock(analysis.ticker, quantity, currentPrice)
          
          // 주문 후 3초 대기 후 체결 내역 확인
          console.log('\n⏳ 주문 체결 확인 중 (3초 대기)...')
          await new Promise(resolve => setTimeout(resolve, 3000))
          await this.kisApi.getOrderList()
        } else {
          console.log(`   [시뮬레이션] 매수 주문 (실제 주문 안함)`)
        }
        
        // 뉴스 아이템에 매수 시간 기록
        const { updateNewsItem } = await import('./server.js')
        updateNewsItem(analysis.ticker, { buyTime })
        
        // 포지션 추가
        const position: Position = {
          ticker: analysis.ticker,
          quantity,
          buyPrice: currentPrice,
          currentPrice,
          profitLoss: 0,
          profitLossPercent: 0,
          buyTime
        }
        
        this.positions.push(position)
        this.savePositions()
        
        // 거래 이력 저장
        this.saveTradingHistory({
          type: 'BUY',
          ticker: analysis.ticker,
          quantity,
          price: currentPrice,
          amount: currentPrice * quantity,
          reason: `자동매매 - 호재 ${analysis.positivePercentage}%`,
          news: newsItem.titleKo,
          timestamp: buyTime
        })
        
        console.log(`✅ 자동매매 완료: ${analysis.ticker} x ${quantity}주 @ $${currentPrice}`)
        console.log(`${'='.repeat(60)}\n`)
        
      } else if (analysis.positivePercentage >= 80) {
        // 수동매매 신호만 (사용자가 직접 구매버튼 클릭해야 함)
        console.log(`\n${'='.repeat(60)}`)
        console.log(`🔔 수동매매 신호 감지! (호재 ${analysis.positivePercentage}%)`)
        console.log(`   티커: ${analysis.ticker}`)
        console.log(`   현재가: $${currentPrice}`)
        console.log(`   뉴스: ${newsItem.titleKo}`)
        console.log(`   매수 전략: 현 잔고의 10%`)
        console.log(`   → 사용자가 직접 구매버튼을 눌러야 합니다`)
        console.log(`${'='.repeat(60)}\n`)
        
        // 수동매매 신호를 위한 데이터 저장 (프론트엔드에서 구매버튼 표시용)
        this.saveTradingHistory({
          type: 'SIGNAL',
          ticker: analysis.ticker,
          quantity: 0,
          price: currentPrice,
          amount: 0,
          reason: `수동매매 신호 - 호재 ${analysis.positivePercentage}%`,
          news: newsItem.titleKo,
          timestamp: new Date().toISOString()
        })
      }
      
    } catch (error) {
      console.error(`✗ 매매 분석 실패:`, error)
    }
  }

  // 포지션 모니터링 및 손익 관리
  async monitorPositions(): Promise<void> {
    if (this.positions.length === 0) {
      return
    }

    console.log(`\n📊 포지션 모니터링 (${this.positions.length}개)`)
    
    for (let i = this.positions.length - 1; i >= 0; i--) {
      const position = this.positions[i]
      
      try {
        // 현재가 조회 (FMP만 사용 - KIS API는 제한이 너무 심함)
        const currentPrice = await this.fmpApi.getCurrentPrice(position.ticker)
        
        // 현재가 조회 실패 시 스킵
        if (!currentPrice || isNaN(currentPrice)) {
          console.log(`   ⚠️  ${position.ticker} 현재가 조회 실패`)
          continue
        }
        
        // 손익 계산
        position.currentPrice = currentPrice
        position.profitLoss = (currentPrice - position.buyPrice) * position.quantity
        position.profitLossPercent = ((currentPrice - position.buyPrice) / position.buyPrice) * 100
        
        console.log(`   ${position.ticker}: $${currentPrice} (${position.profitLossPercent.toFixed(2)}%)`)
        
        // 손절/익절 체크
        const shouldSell = 
          position.profitLossPercent <= this.config.stopLoss ||
          position.profitLossPercent >= this.config.takeProfit
        
        if (shouldSell) {
          const reason = position.profitLossPercent <= this.config.stopLoss ? '손절' : '익절'
          const mode = this.config.testMode ? '[테스트]' : '[실제]'
          
          console.log(`   🔔 ${mode} ${reason} 조건 충족: ${position.profitLossPercent.toFixed(2)}%`)
          
          // 매도 주문 (테스트 모드면 실제 주문 안함)
          if (!this.config.testMode) {
            await this.kisApi.sellStock(position.ticker, position.quantity)
          } else {
            console.log(`   [시뮬레이션] 매도 주문 (실제 주문 안함)`)
          }
          
          // 거래 이력 저장
          this.saveTradingHistory({
            type: 'SELL',
            ticker: position.ticker,
            quantity: position.quantity,
            price: currentPrice,
            amount: currentPrice * position.quantity,
            profitLoss: position.profitLoss,
            profitLossPercent: position.profitLossPercent,
            reason,
            timestamp: new Date().toISOString()
          })
          
          console.log(`   ✅ 매도 완료: ${position.ticker} x ${position.quantity}주 @ $${currentPrice}`)
          console.log(`   💰 손익: $${position.profitLoss.toFixed(2)} (${position.profitLossPercent.toFixed(2)}%)`)
          
          // 포지션 제거
          this.positions.splice(i, 1)
        }
        
      } catch (error) {
        console.error(`   ✗ ${position.ticker} 모니터링 실패:`, error)
      }
    }
    
    this.savePositions()
  }

  // 주기적 모니터링 시작
  startMonitoring(intervalMinutes: number = 5): void {
    if (this.isMonitoring) {
      return
    }
    
    this.isMonitoring = true
    console.log(`👁️  포지션 모니터링 시작 (${intervalMinutes}분 간격)`)
    
    // 즉시 한 번 실행
    this.monitorPositions()
    
    // 주기적 실행
    setInterval(() => {
      this.monitorPositions()
    }, intervalMinutes * 60 * 1000)
  }

  // 현재 포지션 조회
  getPositions(): Position[] {
    return this.positions
  }

  // 설정 조회
  getConfig(): TradingConfig {
    return this.config
  }

  // 잔고 조회
  async getBalance(): Promise<{ buyingPower: number; totalBalance: number; cash: number }> {
    try {
      const balance = await this.kisApi.getBuyingPower()
      console.log('💰 잔고 조회:', balance)
      return {
        buyingPower: balance.buyingPower || 0,
        totalBalance: balance.totalBalance || 0,
        cash: balance.cash || 0
      }
    } catch (error) {
      console.error('❌ 잔고 조회 실패:', error)
      return {
        buyingPower: 0,
        totalBalance: 0,
        cash: 0
      }
    }
  }

  // 설정 업데이트
  updateConfig(newConfig: Partial<TradingConfig>): void {
    this.config = { ...this.config, ...newConfig }
    console.log('⚙️  Trading config updated:', this.config)
  }

  // 수동 매수 실행
  async executeManualBuy(ticker: string, currentPrice: number, newsTitle: string): Promise<{ success: boolean; pending?: boolean; message?: string }> {
    try {
      // 장 시간 체크 - 장 마감 시 예약 주문 등록
      if (!this.isMarketOpen()) {
        // 현재가 조회
        if (!currentPrice || isNaN(currentPrice) || currentPrice === 0) {
          currentPrice = await this.fmpApi.getCurrentPrice(ticker) || 0
        }
        
        if (currentPrice > 0) {
          // 매수 가능 금액 조회
          const buyingPower = await this.kisApi.getBuyingPower()
          const investmentAmount = buyingPower * 0.1
          const quantity = Math.floor(investmentAmount / currentPrice)
          
          if (quantity >= 1) {
            const now = new Date()
            const day = now.getDay()
            const reason = day === 0 || day === 6 ? '주말' : '장 마감'
            
            this.addPendingOrder(
              ticker,
              quantity,
              currentPrice,
              newsTitle,
              `수동매매 - ${reason}`
            )
            
            console.log(`\n${'='.repeat(60)}`)
            console.log(`📌 예약 주문 등록 완료!`)
            console.log(`   티커: ${ticker}`)
            console.log(`   수량: ${quantity}주`)
            console.log(`   가격: $${currentPrice}`)
            console.log(`   다음 장 시작 시 자동 실행됩니다 (23:30)`)
            console.log(`${'='.repeat(60)}\n`)
            
            return { success: true, pending: true, message: '예약 주문 등록 완료' }
          }
        }
        
        console.log(`\n${'='.repeat(60)}`)
        console.log(`⏰ 장 시작 전 또는 장 마감`)
        console.log(`   거래 가능 시간: 한국시간 23:30 ~ 06:00 (월~금)`)
        console.log(`   현재는 주문이 불가능합니다.`)
        console.log(`${'='.repeat(60)}\n`)
        return { success: false, message: '장 마감' }
      }

      // 현재가 검증 및 조회
      if (!currentPrice || isNaN(currentPrice) || currentPrice === 0) {
        console.log(`⚠️  전달된 현재가 없음, FMP에서 조회...`)
        const fetchedPrice = await this.fmpApi.getCurrentPrice(ticker)
        
        if (!fetchedPrice || isNaN(fetchedPrice)) {
          console.log(`❌ 현재가 조회 실패: ${ticker}`)
          return { success: false, message: '현재가 조회 실패' }
        }
        
        currentPrice = fetchedPrice
        console.log(`✓ FMP 현재가: $${currentPrice}`)
      }
      
      // 이미 보유 중인지 확인
      const existingPosition = this.positions.find(p => p.ticker === ticker)
      if (existingPosition) {
        console.log(`⏭️  스킵: ${ticker} 이미 보유 중`)
        return { success: false, message: '이미 보유 중' }
      }

      // 매수 가능 금액 조회 (티커 전달)
      let buyingPower = await this.kisApi.getBuyingPower(ticker)
      if (buyingPower === 0) {
        console.log('   매수가능금액이 0이므로 외화잔고 조회 시도...')
        buyingPower = await this.kisApi.getForeignCurrencyBalance()
      }
      
      // 잔고가 없으면 매수 불가
      if (buyingPower === 0) {
        console.log(`❌ 매수 불가: 잔고 없음`)
        return { success: false, message: '잔고 없음' }
      }
      
      console.log(`💵 사용 가능 잔고: $${buyingPower.toFixed(2)}`)
      console.log(`   매수 전략: 현 잔고의 10%`)
      
      // 매수 금액 계산 (현 잔고의 10% 또는 최대 포지션 크기 중 작은 값)
      const orderAmount = Math.min(this.config.maxPositionSize, buyingPower * 0.10) // 현 잔고의 10%
      const quantity = Math.floor(orderAmount / currentPrice)
      
      if (quantity < 1) {
        console.log(`⚠️  매수 불가: 수량 부족 (가능 금액: $${buyingPower})`)
        return { success: false, message: '잔고 부족' }
      }

      // 매수 주문 (테스트 모드면 실제 주문 안함)
      const buyTime = new Date().toISOString()
      if (!this.config.testMode) {
        // 현재가를 전달하여 지정가 주문
        const orderResult = await this.kisApi.buyStock(ticker, quantity, currentPrice)
        
        // 주문 후 3초 대기 후 체결 내역 확인
        console.log('\n⏳ 주문 체결 확인 중 (3초 대기)...')
        await new Promise(resolve => setTimeout(resolve, 3000))
        await this.kisApi.getOrderList()
      } else {
        console.log(`   [시뮬레이션] 매수 주문 (실제 주문 안함)`)
      }
      
      // 뉴스 아이템에 매수 시간 기록
      const { updateNewsItem } = await import('./server.js')
      updateNewsItem(ticker, { buyTime })
      
      // 포지션 추가
      const position: Position = {
        ticker,
        quantity,
        buyPrice: currentPrice,
        currentPrice,
        profitLoss: 0,
        profitLossPercent: 0,
        buyTime
      }
      
      this.positions.push(position)
      this.savePositions()
      
      // 거래 이력 저장
      this.saveTradingHistory({
        type: 'BUY',
        ticker,
        quantity,
        price: currentPrice,
        amount: currentPrice * quantity,
        reason: `수동매매 - 호재 뉴스`,
        news: newsTitle,
        timestamp: buyTime
      })
      
      console.log(`✅ 수동매매 완료: ${ticker} x ${quantity}주 @ $${currentPrice}`)
      console.log(`${'='.repeat(60)}\n`)
      return { success: true, message: '매수 완료' }
      
    } catch (error: any) {
      console.error('수동 매수 실패:', error)
      return { success: false, message: error.message || '매수 실패' }
    }
  }
}

