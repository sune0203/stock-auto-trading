// 자동 매수 서비스
import { pool, NewsFromDB } from './db.js'
import { kisApiManager } from './kis-api-manager.js'
import { accountCacheService } from './account-cache.js'
import { saveTradingRecord, saveDBPosition } from './db.js'
import { TradingManager } from './trading-manager.js'

const tradingManager = new TradingManager()

interface ProcessedNews {
  n_idx: number
  processed_at: Date
}

interface AutoTradingConfig {
  enabled: boolean
  bullish_threshold: number // 호재 점수 임계값 (%)
  impact_threshold: number // 당일 상승 점수 임계값 (%)
  investment_percent: number // 잔고 대비 투자 비율 (%)
  max_investment: number // 최대 투자 금액 ($)
  take_profit_percent: number // 익절 비율 (%)
  stop_loss_percent: number // 손절 비율 (%)
}

export class AutoTradingService {
  private processedNews: Set<number> = new Set()
  private checkInterval: NodeJS.Timeout | null = null
  private isRunning = false
  private config: AutoTradingConfig = {
    enabled: false,
    bullish_threshold: 95,
    impact_threshold: 95,
    investment_percent: 10,
    max_investment: 1000,
    take_profit_percent: 10,
    stop_loss_percent: 5
  }
  
  // 감지된 뉴스 캐시 (설정창용)
  private detectedNewsCache: any[] = []
  private lastCacheUpdate: Date | null = null
  private cacheValiditySeconds = 30 // 30초 동안 캐시 유효

  // 자동 매수 시작
  start() {
    if (this.isRunning) {
      console.log('⚠️ 자동 매수 서비스가 이미 실행 중입니다')
      return
    }

    console.log('🤖 자동 매수 서비스 시작 (5초 간격)')
    this.isRunning = true
    this.config.enabled = true
    
    // 즉시 실행
    this.checkHighScoreNews()
    
    // 5초마다 체크
    this.checkInterval = setInterval(() => {
      this.checkHighScoreNews()
    }, 5000) // 5초마다 체크
  }

  // 자동 매수 중지
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    this.isRunning = false
    this.config.enabled = false
    console.log('🛑 자동 매수 서비스 중지')
  }


  // 설정 조회
  getConfig() {
    return { ...this.config, enabled: this.isRunning }
  }

  // 설정 저장
  setConfig(newConfig: Partial<AutoTradingConfig>) {
    this.config = { ...this.config, ...newConfig }
    console.log('⚙️ 자동매수 설정 업데이트:', this.config)
  }

   // 감지된 뉴스 조회 (설정창용: 유효한 티커 5개만)
   async getDetectedNews() {
     try {
       // 캐시가 유효한지 확인
       const now = new Date()
       if (
         this.lastCacheUpdate && 
         this.detectedNewsCache.length > 0 &&
         (now.getTime() - this.lastCacheUpdate.getTime()) / 1000 < this.cacheValiditySeconds
       ) {
         console.log(`💾 [설정창] 캐시된 뉴스 반환 (${this.detectedNewsCache.length}개)`)
         return this.detectedNewsCache
       }

       console.log(`\n🔍 [설정창] 감지된 뉴스 조회 (캐시 갱신)`)
       console.log(`  📊 조건: 호재 >= ${this.config.bullish_threshold}% OR 상승 >= ${this.config.impact_threshold}%`)
       
       // DB에서 최신 뉴스 20개 가져오기 (n_ticker 또는 n_symbol이 있으면 포함)
       const [rows] = await pool.query(
         `SELECT n_idx, n_ticker, n_symbol, n_title, n_title_kr, n_bullish, n_immediate_impact, 
                 n_in_time, captured_price, trade_volume
          FROM _NEWS 
          WHERE n_gpt_is = 'Y' 
          AND ((n_ticker IS NOT NULL AND n_ticker != '') OR (n_symbol IS NOT NULL AND n_symbol != ''))
          AND (n_bullish >= ? OR n_immediate_impact >= ?)
          ORDER BY n_in_time DESC
          LIMIT 20`,
         [this.config.bullish_threshold, this.config.impact_threshold]
       )

       const news = rows as any[]
       console.log(`  📰 DB 조회: ${news.length}개`)

       if (news.length === 0) {
         console.log(`  ⚠️ 조건에 맞는 뉴스 없음`)
         this.detectedNewsCache = []
         this.lastCacheUpdate = now
         return []
       }

       // 각 뉴스 검증 (유효한 5개만 수집)
       const validNews: any[] = []
       
       for (let i = 0; i < news.length && validNews.length < 5; i++) {
         const item = news[i]
         
         try {
           // n_ticker 또는 n_symbol 중 사용할 티커 결정
           const primaryTicker = item.n_ticker || item.n_symbol
           const alternateTicker = (item.n_ticker && item.n_symbol && item.n_ticker !== item.n_symbol) 
             ? (item.n_ticker ? item.n_symbol : item.n_ticker) 
             : null
           
           console.log(`  [${i + 1}/${news.length}] ${primaryTicker}${alternateTicker ? ` (대체: ${alternateTicker})` : ''} 검증 중...`)
           
           // FMP API로 현재가 조회
           const fmpApiKey = process.env.FMP_API_KEY
           const quoteResponse = await fetch(
             `https://financialmodelingprep.com/api/v3/quote/${primaryTicker}?apikey=${fmpApiKey}`
           )
           const quoteData = await quoteResponse.json() as any[]
           
           // 가격 및 변동률 확인
           const quote = quoteData && quoteData.length > 0 ? quoteData[0] : null
           const currentPrice = quote?.price ? Number(quote.price) : 0
           const changePercent = quote?.changesPercentage ? Number(quote.changesPercentage) : 0
           const change = quote?.change ? Number(quote.change) : 0
           const dayOpen = quote?.open ? Number(quote.open) : 0
           const previousClose = quote?.previousClose ? Number(quote.previousClose) : 0
           
           if (currentPrice <= 0) {
             console.log(`    ❌ 무효 (가격 없음)`)
             continue // 다음 뉴스로
           }

           // 한국어 종목명 조회
           const [stockRows] = await pool.query(
             `SELECT s_name_kr FROM _STOCKS WHERE s_ticker = ?`,
             [primaryTicker]
           )
           const stockNameKo = (stockRows as any[])[0]?.s_name_kr || ''

           // 뉴스 캡처 당시 가격 및 거래량
           const capturedPrice = item.captured_price ? Number(item.captured_price) / 1437.7 : null // KRW → USD 환산
           const capturedVolume = item.trade_volume ? Number(item.trade_volume) : null

           console.log(`    ✅ $${currentPrice.toFixed(2)} ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}% - ${stockNameKo || primaryTicker}`)
           if (capturedPrice) {
             console.log(`       캡처시: $${capturedPrice.toFixed(2)} / 거래량: ${capturedVolume?.toLocaleString() || 'N/A'}`)
           }

           validNews.push({
             ...item,
             primaryTicker, // 우선 티커
             alternateTicker, // 대체 티커 (있을 경우)
             currentPrice,
             changePercent,
             change,
             dayOpen,
             previousClose,
             stockNameKo,
             capturedPriceUSD: capturedPrice,
             capturedVolume,
             isValidTicker: true
           })
         } catch (error: any) {
           console.log(`    ⚠️ 오류: ${error.message}`)
           continue
         }
       }

       console.log(`  ✅ 유효한 뉴스: ${validNews.length}개`)
       if (validNews.length > 0) {
         console.log(`  📋 티커: ${validNews.map((n: any) => n.n_ticker).join(', ')}`)
       }
       
       // 캐시 업데이트
       this.detectedNewsCache = validNews
       this.lastCacheUpdate = now
       console.log(`💾 캐시 업데이트 완료 (다음 갱신: ${this.cacheValiditySeconds}초 후)`)
       
       return validNews
    } catch (error) {
      console.error('감지된 뉴스 조회 오류:', error)
      return []
    }
  }

  // 수동 즉시 매수
  async manualBuy(ticker: string, newsTitle: string, bullishScore: number, impactScore: number) {
    try {
      // 실전투자 계정 확인
      const currentAccount = kisApiManager.getCurrentAccount()
      if (!currentAccount || currentAccount.ka_type !== 'REAL') {
        throw new Error('실전투자 계정에서만 사용 가능합니다')
      }

      // 장 오픈 체크
      if (!this.isMarketOpen()) {
        throw new Error('장 마감 중입니다. 거래 시간: 월~금 09:30~16:00 (EST)')
      }

      // 상승 추이 분석
      const priceHistory = await this.analyzePriceTrend(ticker)
      if (!priceHistory.isUptrend) {
        throw new Error(
          `상승 추이가 부족합니다 (현재: ${priceHistory.trendPercent > 0 ? '+' : ''}${priceHistory.trendPercent.toFixed(2)}%, 최소 필요: +0.5%)`
        )
      }

      // 잔고 조회
      const balance = await accountCacheService.getBalance()
      const buyingPower = balance.cash || 0
      const investAmount = Math.min(
        buyingPower * (this.config.investment_percent / 100),
        this.config.max_investment
      )

      if (investAmount < 1) {
        throw new Error('투자 가능 금액이 부족합니다')
      }

      const currentPrice = priceHistory.currentPrice
      const quantity = Math.floor(investAmount / currentPrice)

      if (quantity < 1) {
        throw new Error('구매 가능 수량이 부족합니다')
      }

      // 매수 주문 (KIS API 직접 호출)
      const orderResult = await kisApiManager.buyStock(ticker, quantity, currentPrice)

      // 거래 기록 저장
      await saveTradingRecord({
        t_account_type: currentAccount.ka_type,
        t_ticker: ticker,
        t_type: 'BUY',
        t_price: currentPrice,
        t_quantity: quantity,
        t_total_amount: quantity * currentPrice,
        t_status: 'COMPLETED',
        t_profit_loss: undefined,
        t_profit_loss_rate: undefined,
        t_reason: `수동매수 (호재:${bullishScore}%, 당일상승:${impactScore}%, 추이:+${priceHistory.trendPercent.toFixed(2)}%)`,
        t_executed_at: new Date()
      })

      console.log(`✅ 수동 매수 성공: ${ticker} ${quantity}주 @ $${currentPrice.toFixed(2)}`)

      return {
        success: true,
        ticker,
        quantity,
        price: currentPrice,
        totalAmount: quantity * currentPrice
      }
    } catch (error: any) {
      console.error('수동 매수 실패:', error)
      throw error
    }
  }

  // 높은 점수의 뉴스 확인
  private async checkHighScoreNews() {
    try {
      // 실전투자 계정 확인
      const currentAccount = kisApiManager.getCurrentAccount()
      if (!currentAccount || currentAccount.ka_type !== 'REAL') {
        // console.log('⚠️ 자동 매수는 실전투자 계정에서만 작동합니다')
        return
      }

      // 실시간으로 갱신된 뉴스만 조회 (최근 1분 이내)
      const [rows] = await pool.query(
        `SELECT * FROM _NEWS 
         WHERE n_gpt_is = 'Y' 
         AND n_ticker IS NOT NULL 
         AND n_ticker != ''
         AND (n_bullish >= ? OR n_immediate_impact >= ?)
         AND n_in_time >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)
         ORDER BY n_in_time DESC`,
        [this.config.bullish_threshold, this.config.impact_threshold]
      )

      const news = rows as NewsFromDB[]

      // 상세 로그: 체크 시작
      const now = new Date()
      const kstTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
      const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      
      console.log(`\n🔍 [자동매수] 뉴스 체크 시작`)
      console.log(`  ⏰ KST: ${kstTime.toLocaleString('ko-KR')}`)
      console.log(`  ⏰ EST: ${estTime.toLocaleString('en-US')}`)
      console.log(`  📊 설정 - 호재: ${this.config.bullish_threshold}%, 상승: ${this.config.impact_threshold}%`)
      console.log(`  💰 투자비율: ${this.config.investment_percent}%, 최대: $${this.config.max_investment}`)
      console.log(`  📰 조회된 뉴스: ${news.length}개`)

      // 새로운 뉴스가 없으면 로그 출력
      if (news.length === 0) {
        console.log(`  ⚠️ 최근 1분 내 높은 점수 뉴스 없음`)
        console.log(`✅ [자동매수] 뉴스 체크 완료\n`)
        return
      }

      for (const item of news) {
        // 이미 처리한 뉴스는 건너뛰기
        if (this.processedNews.has(item.n_idx)) {
          console.log(`  ⏭️ 이미 처리한 뉴스 스킵: ${item.n_ticker}`)
          continue
        }

        // 점수 확인
        const bullishScore = item.n_bullish || 0
        const impactScore = item.n_immediate_impact || 0

        console.log(`  📰 뉴스 #${item.n_idx}: ${item.n_ticker} - 호재:${bullishScore}% 상승:${impactScore}%`)

        // 1️⃣ 유효한 티커인지 먼저 확인 (FMP API로 가격 조회)
        try {
          const fmpApiKey = process.env.FMP_API_KEY
          const quoteResponse = await fetch(
            `https://financialmodelingprep.com/api/v3/quote/${item.n_ticker}?apikey=${fmpApiKey}`
          )
          const quoteData = await quoteResponse.json() as any[]
          
          if (!quoteData || quoteData.length === 0 || !quoteData[0]?.price) {
            console.log(`  ⚠️ 유효하지 않은 티커: ${item.n_ticker} (FMP에서 가격 조회 불가)`)
            this.processedNews.add(item.n_idx) // 다시 시도하지 않도록 기록
            continue
          }
        } catch (error) {
          console.log(`  ❌ 티커 검증 실패: ${item.n_ticker}`)
          this.processedNews.add(item.n_idx)
          continue
        }

        if (bullishScore >= this.config.bullish_threshold || impactScore >= this.config.impact_threshold) {
          console.log(`\n🎯 [높은 점수 뉴스 감지!]`)
          console.log(`  📌 종목: ${item.n_ticker}`)
          console.log(`  📰 제목: ${item.n_title_kr || item.n_title}`)
          console.log(`  📊 호재점수: ${bullishScore}%`)
          console.log(`  📈 당일상승점수: ${impactScore}%`)
          console.log(`  ⏰ 입력시간: ${item.n_in_time}`)

          // 자동 매수 실행
          await this.executeAutoBuy(item, bullishScore, impactScore)

          // 처리 완료 표시
          this.processedNews.add(item.n_idx)

          // 메모리 관리: 1000개 이상 쌓이면 오래된 것 삭제
          if (this.processedNews.size > 1000) {
            const array = Array.from(this.processedNews)
            this.processedNews = new Set(array.slice(-500))
          }
        }
      }
      
      console.log(`✅ [자동매수] 뉴스 체크 완료\n`)
    } catch (error) {
      console.error('❌ 자동 매수 체크 실패:', error)
    }
  }

  // 미국 시장 오픈 여부 확인
  private isMarketOpen(): boolean {
    const now = new Date()
    const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = nyTime.getDay() // 0=일요일, 6=토요일
    const hours = nyTime.getHours()
    const minutes = nyTime.getMinutes()
    const currentMinutes = hours * 60 + minutes

    // 주말 체크
    if (day === 0 || day === 6) {
      return false
    }

    // 9:30 AM ~ 4:00 PM (EST)
    const marketOpen = 9 * 60 + 30 // 9:30 AM = 570분
    const marketClose = 16 * 60 // 4:00 PM = 960분

    return currentMinutes >= marketOpen && currentMinutes < marketClose
  }

  // 상승 추이 분석 (장 시작가 대비 현재가)
  private async analyzePriceTrend(ticker: string): Promise<{
    isUptrend: boolean
    trendPercent: number
    currentPrice: number
  }> {
    try {
      const fmpApiKey = process.env.FMP_API_KEY
      if (!fmpApiKey) {
        console.error('❌ FMP API 키가 설정되지 않았습니다')
        return { isUptrend: false, trendPercent: 0, currentPrice: 0 }
      }

      // 1분봉 데이터 조회 (전체 조회하여 장 시작가 확인)
      const chartResponse = await fetch(
        `https://financialmodelingprep.com/api/v3/historical-chart/1min/${ticker}?apikey=${fmpApiKey}`
      )
      const chartData = await chartResponse.json() as any[]

      if (!Array.isArray(chartData) || chartData.length === 0) {
        console.warn(`⚠️ 차트 데이터 부족 (${ticker}): ${chartData?.length || 0}개`)
        return { isUptrend: false, trendPercent: 0, currentPrice: 0 }
      }

      // 장 시작가 = 가장 오래된 데이터의 open (FMP는 최신 데이터가 앞, 오래된 데이터가 뒤)
      const openingPrice = chartData[chartData.length - 1].open
      const currentPrice = chartData[0].close // 현재 가격 (최신 데이터)

      // 상승률 계산 (장 시작가 대비)
      const trendPercent = ((currentPrice - openingPrice) / openingPrice) * 100

      // 상승 추이 조건: 최소 +0.5% 이상
      const isUptrend = trendPercent >= 0.5

      console.log(`📊 [${ticker}] 장 시작가 대비 추이 분석:`)
      console.log(`   시가: $${openingPrice.toFixed(2)}`)
      console.log(`   현재가: $${currentPrice.toFixed(2)}`)
      console.log(`   변화율: ${trendPercent > 0 ? '+' : ''}${trendPercent.toFixed(2)}%`)

      return {
        isUptrend,
        trendPercent,
        currentPrice
      }
    } catch (error) {
      console.error(`❌ 상승 추이 분석 실패 (${ticker}):`, error)
      return { isUptrend: false, trendPercent: 0, currentPrice: 0 }
    }
  }

  // 자동 매수 실행
  private async executeAutoBuy(news: NewsFromDB, bullishScore: number, impactScore: number) {
    try {
      const ticker = news.n_ticker!

      console.log(`\n💡 [자동매수 실행 시작: ${ticker}]`)
      console.log(`─────────────────────────────────────`)

      // 0. 장 오픈 체크 (필수)
      const marketOpen = this.isMarketOpen()
      const now = new Date()
      const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const day = estTime.getDay() // 0=일요일, 6=토요일
      const hours = estTime.getHours()
      const minutes = estTime.getMinutes()
      
      console.log(`\n📅 [1단계] 시장 오픈 확인`)
      console.log(`  ⏰ 현재 EST 시간: ${estTime.toLocaleString('en-US')}`)
      console.log(`  📆 요일: ${['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'][day]}`)
      console.log(`  🕐 시간: ${hours}:${minutes.toString().padStart(2, '0')}`)
      console.log(`  📊 시장 상태: ${marketOpen ? '✅ 오픈' : '❌ 마감'}`)
      console.log(`  🏢 거래 시간: 월~금 09:30~16:00 (EST)`)
      
      if (!marketOpen) {
        console.log(`\n⏰ [자동매수 중단] 장 마감 시간입니다`)
        console.log(`─────────────────────────────────────\n`)
        return
      }

      console.log(`  ✅ 장 오픈 확인 완료 - 매수 진행`)

      // 1. 현재 잔고 조회
      console.log(`\n💰 [2단계] 잔고 확인`)
      const balance = await accountCacheService.getBalance()
      const buyingPower = balance.cash || 0

      console.log(`  💵 현재 잔고: $${buyingPower.toFixed(2)}`)

      if (buyingPower <= 0) {
        console.log(`\n❌ [자동매수 중단] 매수 가능 금액이 없습니다`)
        console.log(`─────────────────────────────────────\n`)
        return
      }

      // 2. 투자 금액 계산 (설정된 비율 사용, 최대 한도 적용)
      const investAmount = Math.min(
        buyingPower * (this.config.investment_percent / 100),
        this.config.max_investment
      )

      console.log(`  📊 투자비율: ${this.config.investment_percent}%`)
      console.log(`  📊 최대금액: $${this.config.max_investment}`)
      console.log(`  💵 실제 투자금액: $${investAmount.toFixed(2)}`)
      console.log(`  ✅ 잔고 확인 완료`)

      // 3. 상승 추이 분석 (장 시작가 대비)
      console.log(`\n📈 [3단계] 상승 추이 분석`)
      const priceHistory = await this.analyzePriceTrend(ticker)
      
      if (!priceHistory.isUptrend) {
        console.log(`\n📉 [자동매수 중단] 상승 추이 미달`)
        console.log(`  장 시작가 대비: ${priceHistory.trendPercent > 0 ? '+' : ''}${priceHistory.trendPercent.toFixed(2)}%`)
        console.log(`  요구 조건: 최소 +0.5% 이상 상승`)
        console.log(`─────────────────────────────────────\n`)
        return
      }

      console.log(`  ✅ 상승 추이 확인: ${priceHistory.trendPercent > 0 ? '+' : ''}${priceHistory.trendPercent.toFixed(2)}%`)

      // 4. 현재 주가 (상승 추이 분석에서 얻은 값 사용)
      const currentPrice = priceHistory.currentPrice

      // 5. 매수 수량 계산
      console.log(`\n🔢 [4단계] 매수 수량 계산`)
      console.log(`  💵 투자금액: $${investAmount.toFixed(2)}`)
      console.log(`  📊 현재가: $${currentPrice.toFixed(2)}`)
      
      const quantity = Math.floor(investAmount / currentPrice)
      
      console.log(`  🔢 매수수량: ${quantity}주`)

      if (quantity <= 0) {
        console.log(`\n❌ [자동매수 중단] 매수 가능 수량이 없습니다 (주가가 너무 높음)`)
        console.log(`─────────────────────────────────────\n`)
        return
      }

      console.log(`  ✅ 매수 수량 계산 완료`)

      console.log(`\n✅ [최종 매수 결정]`)
      console.log(`   현재가: $${currentPrice.toFixed(2)}`)
      console.log(`   매수 수량: ${quantity}주`)
      console.log(`   총 금액: $${(currentPrice * quantity).toFixed(2)}`)
      console.log(`   상승 추이: +${priceHistory.trendPercent.toFixed(2)}%`)

      // 6. KIS API로 매수 주문
      console.log(`\n🚀 자동 매수 주문 실행 중...`)
      
      const orderResult = await kisApiManager.buyStock(
        ticker,
        quantity,
        currentPrice
      )

      if (orderResult.success) {
        console.log(`✅ 자동 매수 성공!`)
        console.log(`  주문번호: ${orderResult.orderNumber}`)

        // 7. 거래 기록 저장
        await saveTradingRecord({
          t_ticker: ticker,
          t_account_type: 'REAL',
          t_type: 'BUY',
          t_price: currentPrice,
          t_quantity: quantity,
          t_total_amount: currentPrice * quantity,
          t_status: 'COMPLETED',
          t_profit_loss: undefined,
          t_profit_loss_rate: undefined,
          t_reason: `자동매수 (호재:${bullishScore}%, 당일상승:${impactScore}%, 추이:+${priceHistory.trendPercent.toFixed(2)}%)`,
          t_executed_at: new Date()
        })

      // 8. 익절/손절 설정 저장 (포지션 DB에 저장)
      await saveDBPosition({
        p_ticker: ticker,
        p_account_type: 'REAL',
        p_quantity: quantity,
        p_buy_price: currentPrice,
        p_current_price: currentPrice,
        p_profit_loss: 0,
        p_profit_loss_percent: 0,
        p_take_profit_enabled: this.config.take_profit_percent > 0,
        p_take_profit_percent: this.config.take_profit_percent,
        p_stop_loss_enabled: this.config.stop_loss_percent > 0,
        p_stop_loss_percent: this.config.stop_loss_percent
      })

        // 9. 캐시 무효화 (잔고 및 포지션 갱신)
        const account = kisApiManager.getCurrentAccount()
        if (account) {
          accountCacheService.onAccountSwitch(account.ka_type, account.ka_account_no)
        }

        console.log(`📝 거래 기록 및 익절/손절 설정 저장 완료`)
        console.log(`   익절: ${this.config.take_profit_percent}%, 손절: ${this.config.stop_loss_percent}%\n`)
      } else {
        console.error(`❌ 자동 매수 실패:`, orderResult.message)
      }

    } catch (error) {
      console.error('❌ 자동 매수 실행 실패:', error)
    }
  }

  // 서비스 상태 조회
  getStatus(): { enabled: boolean; isRunning: boolean } {
    return {
      enabled: this.isRunning,
      isRunning: this.isRunning
    }
  }
}

// 싱글톤 인스턴스
export const autoTradingService = new AutoTradingService()

