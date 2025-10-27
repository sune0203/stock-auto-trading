import mysql from 'mysql2/promise'
import 'dotenv/config'
import { KISApi } from './kis-api.js'
import { FMPApi } from './fmp-api.js'

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'nasdaq',
  password: process.env.DB_PASS || 'core1601!',
  database: process.env.DB_NAME || 'nasdaq',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
})

interface Balance {
  buyingPower: number
  totalBalance: number
  cash: number
}

interface Position {
  ticker: string
  name?: string // 종목명 추가
  quantity: number
  buyPrice: number
  currentPrice: number
  profitLoss: number
  profitLossPercent: number
  buyTime?: string
}

export class AccountCacheService {
  private kisApi: KISApi
  private fmpApi: FMPApi
  private accountNo: string
  private lastBalanceUpdate: Date | null = null
  private lastPositionUpdate: Date | null = null
  private balanceUpdateInterval = 60000 // 1분
  private positionUpdateInterval = 30000 // 30초
  
  // 메모리 캐시 (DB 대신 사용)
  private cachedPositions: Position[] = []
  
  // 현재 계좌 타입 추적 (계좌 전환 감지용)
  private currentAccountType: 'REAL' | 'VIRTUAL' | null = null

  constructor() {
    this.kisApi = new KISApi()
    this.fmpApi = new FMPApi()
    this.accountNo = process.env.KIS_ACCOUNT_NO || '50155376-01'
  }
  
  /**
   * 계좌 전환 시 캐시 무효화
   */
  onAccountSwitch(accountType: 'REAL' | 'VIRTUAL', accountNo: string) {
    console.log(`🔄 계좌 전환 감지: ${this.currentAccountType} → ${accountType}`)
    
    // 계좌가 변경되었으면 모든 캐시 무효화
    if (this.currentAccountType !== accountType) {
      console.log('🧹 캐시 무효화 (계좌 전환)')
      this.lastBalanceUpdate = null
      this.lastPositionUpdate = null
      this.cachedPositions = []
      this.currentAccountType = accountType
      this.accountNo = accountNo
    }
  }

  /**
   * 잔고 조회 (캐시 우선, 오래되면 API 호출)
   */
  async getBalance(): Promise<Balance> {
    try {
      // 1. DB 캐시 조회
      const cached = await this.getCachedBalance()
      
      // 2. 캐시가 최신이면 반환
      const now = new Date()
      if (this.lastBalanceUpdate && 
          (now.getTime() - this.lastBalanceUpdate.getTime()) < this.balanceUpdateInterval) {
        console.log('💰 캐시 사용: 잔고')
        return cached
      }
      
      // 3. API 호출 (KIS API에서 실제 잔고 조회)
      console.log('🔄 API 호출: 잔고 조회')
      const apiBalance = await this.fetchBalanceFromKIS()
      
      // 4. API 호출이 성공했을 때만 DB 업데이트
      if (apiBalance !== null) {
        await this.updateBalanceCache(apiBalance)
        this.lastBalanceUpdate = now
        return apiBalance
      } else {
        // API 실패 시 기존 캐시 유지
        console.log('⚠️ KIS API 실패 - 기존 캐시 유지')
        return cached
      }
    } catch (error) {
      console.error('❌ 잔고 조회 실패:', error)
      // 에러 시 캐시 반환
      return await this.getCachedBalance()
    }
  }

  /**
   * 포지션 조회 (메모리 캐시 우선, 오래되면 KIS API 호출)
   */
  async getPositions(): Promise<Position[]> {
    try {
      const now = new Date()
      
      // 1. 캐시가 최신이면 메모리 캐시 반환 (실시간 가격 업데이트 포함)
      if (this.lastPositionUpdate && 
          (now.getTime() - this.lastPositionUpdate.getTime()) < this.positionUpdateInterval) {
        // 실시간 가격 업데이트 (비동기, 백그라운드)
        this.updatePositionPrices(this.cachedPositions).then(updated => {
          this.cachedPositions = updated
        }).catch(() => {})
        
        return this.cachedPositions
      }
      
      // 2. KIS API 호출 (실제 포지션 조회)
      const apiPositions = await this.fetchPositionsFromKIS()
      
      // 3. API 호출 성공 시 메모리 캐시 업데이트
      if (apiPositions !== null) {
        this.cachedPositions = apiPositions
        this.lastPositionUpdate = now
        await this.updatePositionsCache(apiPositions) // 로그만 출력
        
        // 4. 실시간 가격 업데이트
        const updated = await this.updatePositionPrices(apiPositions)
        this.cachedPositions = updated
        return updated
      } else {
        // API 실패 시 기존 캐시 반환
        return this.cachedPositions
      }
    } catch (error) {
      console.error('❌ 포지션 조회 실패:', error)
      return this.cachedPositions
    }
  }

  /**
   * DB에서 캐시된 잔고 조회
   */
  private async getCachedBalance(): Promise<Balance> {
    const [rows] = await pool.query(
      `SELECT ab_buying_power, ab_total_balance, ab_cash
       FROM _ACCOUNT_BALANCE
       WHERE ab_account_no = ?`,
      [this.accountNo]
    )
    
    const data = (rows as any[])[0]
    if (!data) {
      return { buyingPower: 0, totalBalance: 0, cash: 0 }
    }
    
    return {
      buyingPower: parseFloat(data.ab_buying_power),
      totalBalance: parseFloat(data.ab_total_balance),
      cash: parseFloat(data.ab_cash)
    }
  }

  /**
   * DB에서 캐시된 포지션 조회
   * 
   * 🚨 주의: _POSITIONS 테이블은 익절/손절 설정만 저장합니다.
   * 실제 포지션 데이터는 KIS API에서만 조회합니다.
   * 이 함수는 사용되지 않으며, 하위 호환성을 위해만 유지됩니다.
   */
  private async getCachedPositions(): Promise<Position[]> {
    // KIS API만 사용하므로 빈 배열 반환
    return []
  }

  /**
   * KIS API에서 실제 잔고 조회
   */
  private async fetchBalanceFromKIS(): Promise<Balance | null> {
    try {
      // KIS API 호출 전 대기 (rate limit 방지)
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // 1차 시도: 매수가능금액 조회 API (실제 USD 예수금)
      const buyingPowerData = await this.kisApi.getBuyingPower('QQQ', 1.0)
      
      if (buyingPowerData.cash > 0 && !isNaN(buyingPowerData.cash)) {
        console.log(`💵 매수가능금액 (USD): $${buyingPowerData.cash.toFixed(2)}`)
        
        // 총 자산 계산: 매수가능금액 + 보유종목 평가금액
        const positions = await this.fetchPositionsFromKIS()
        let totalPositionValue = 0
        if (positions && positions.length > 0) {
          totalPositionValue = positions.reduce((sum, pos) => sum + (pos.currentPrice * pos.quantity), 0)
        }
        
        const totalAssets = buyingPowerData.cash + totalPositionValue
        console.log(`💼 총 자산: $${totalAssets.toFixed(2)} (예수금: $${buyingPowerData.cash.toFixed(2)} + 평가금액: $${totalPositionValue.toFixed(2)})`)
        
        return {
          buyingPower: buyingPowerData.cash,
          totalBalance: totalAssets,
          cash: buyingPowerData.cash
        }
      }
      
      // 2차 시도: 기존 잔고조회 API 사용 (폴백)
      console.log('⚠️ 매수가능금액 조회 실패, 잔고조회 API로 폴백')
      
      // 추가 대기 (연속 호출 방지)
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const balanceData = await this.kisApi.getBalance()
      
      // API 응답 검증
      if (!balanceData || balanceData.rt_cd === '1') {
        console.error('❌ 잔고조회 API 실패:', balanceData?.msg1 || '알 수 없는 오류')
        return null
      }
      
      // output2에서 계좌 요약 정보 추출
      const output2 = balanceData.output2 || {}
      
      // 🆕 외화예수금액 (frcr_dncl_amt_2) 사용 - 실제 매수 가능 금액
      const cashBalance = parseFloat(output2.frcr_dncl_amt_2 || '0')
      
      // 보유 종목 평가금액 계산
      const positions = await this.fetchPositionsFromKIS()
      let totalPositionValue = 0
      if (positions && positions.length > 0) {
        totalPositionValue = positions.reduce((sum, pos) => sum + (pos.currentPrice * pos.quantity), 0)
      }
      
      // 총 자산 = 외화예수금 + 보유 종목 평가금액
      const totalAssets = cashBalance + totalPositionValue
      
      console.log(`💵 외화예수금 (매수가능): $${cashBalance.toFixed(2)}`)
      console.log(`💼 총 자산: $${totalAssets.toFixed(2)} (예수금: $${cashBalance.toFixed(2)} + 평가금액: $${totalPositionValue.toFixed(2)})`)
      
      return {
        buyingPower: cashBalance, // 외화예수금액 = 매수 가능 금액
        totalBalance: totalAssets,
        cash: cashBalance
      }
    } catch (error) {
      console.error('❌ KIS 잔고 조회 실패:', error)
      // 실패 시 null 반환 (캐시 유지)
      return null
    }
  }

  /**
   * KIS API에서 실제 포지션 조회
   */
  private async fetchPositionsFromKIS(): Promise<Position[] | null> {
    try {
      // KIS API 호출 전 대기 (rate limit 방지)
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // KIS API의 inquire-balance 사용 (output1에 보유 종목 정보)
      const balanceData = await this.kisApi.getBalance()
      
      // API 응답 검증
      if (!balanceData) {
        console.warn('⚠️ KIS API 응답 없음')
        return null
      }
      
      // rt_cd가 '1'이면 에러 (초당 거래건수 초과 등)
      if (balanceData.rt_cd === '1') {
        console.warn(`⚠️ KIS API 에러: ${balanceData.msg1 || '알 수 없는 오류'}`)
        return null
      }
      
      if (!balanceData.output1) {
        return []
      }
      
      const positions: Position[] = []
      
      // output1의 각 항목이 보유 종목
      for (const item of balanceData.output1) {
        const ticker = item.ovrs_pdno // 해외상품번호 (티커)
        const name = item.ovrs_item_name // 종목명
        const quantity = parseInt(item.ovrs_cblc_qty || '0') // 해외잔고수량
        const buyPrice = parseFloat(item.pchs_avg_pric || '0') // 매입평균가격
        const currentPrice = parseFloat(item.now_pric2 || '0') // 현재가
        const profitLoss = parseFloat(item.frcr_evlu_pfls_amt || '0') // 외화평가손익금액
        const profitLossPercent = parseFloat(item.evlu_pfls_rt || '0') // 평가손익율
        
        if (ticker && quantity > 0) {
          positions.push({
            ticker,
            name,
            quantity,
            buyPrice,
            currentPrice,
            profitLoss,
            profitLossPercent
          })
        }
      }
      
      // 로그 제거 (불필요)
      return positions
    } catch (error) {
      console.error('❌ KIS 포지션 조회 실패:', error)
      return null
    }
  }

  /**
   * 잔고 캐시 업데이트
   */
  private async updateBalanceCache(balance: Balance): Promise<void> {
    const accountType = this.currentAccountType || 'VIRTUAL'
    await pool.query(
      `INSERT INTO _ACCOUNT_BALANCE 
       (ab_account_no, ab_account_type, ab_buying_power, ab_total_balance, ab_cash)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       ab_account_type = VALUES(ab_account_type),
       ab_buying_power = VALUES(ab_buying_power),
       ab_total_balance = VALUES(ab_total_balance),
       ab_cash = VALUES(ab_cash),
       ab_updated_at = CURRENT_TIMESTAMP`,
      [this.accountNo, accountType, balance.buyingPower, balance.totalBalance, balance.cash]
    )
    console.log(`💾 잔고 캐시 업데이트 (${accountType}: ${this.accountNo})`)
  }

  /**
   * 포지션 캐시 업데이트
   * 
   * 🚨 주의: _POSITIONS 테이블은 익절/손절 설정만 저장합니다.
   * 실제 포지션 데이터는 DB에 저장하지 않습니다 (KIS API 단일 소스).
   */
  private async updatePositionsCache(positions: Position[]): Promise<void> {
    // 포지션은 DB에 저장하지 않음 (메모리 캐시만 사용)
    // 로그 제거 (불필요)
  }

  /**
   * 실시간 가격으로 포지션 업데이트
   * 
   * 🚨 주의: DB 업데이트 없음 (메모리 캐시만 사용)
   */
  private async updatePositionPrices(positions: Position[]): Promise<Position[]> {
    if (positions.length === 0) return []

    const tickers = positions.map(p => p.ticker)
    const quotes = await this.fmpApi.getQuotes(tickers)
    
    const updated = positions.map(pos => {
      const quote = quotes.find(q => q.symbol === pos.ticker)
      if (quote) {
        const currentPrice = quote.price
        const profitLoss = (currentPrice - pos.buyPrice) * pos.quantity
        const profitLossPercent = ((currentPrice - pos.buyPrice) / pos.buyPrice) * 100
        
        return {
          ...pos,
          currentPrice,
          profitLoss,
          profitLossPercent,
          totalValue: currentPrice * pos.quantity
        }
      }
      return pos
    })
    
    // ❌ DB 업데이트 제거 (KIS API가 단일 소스)
    
    return updated
  }

  /**
   * 매수 후 포지션 추가/업데이트
   * 
   * 🚨 주의: 사용되지 않음 (KIS API가 단일 소스)
   * 캐시 무효화만 수행
   */
  async addPosition(ticker: string, quantity: number, buyPrice: number): Promise<void> {
    // 캐시 무효화 (다음 조회 시 KIS API에서 최신 데이터 가져옴)
    this.lastPositionUpdate = null
    console.log(`📈 포지션 추가 (캐시 무효화): ${ticker} x${quantity} @ $${buyPrice}`)
  }

  /**
   * 매도 후 포지션 제거/감소
   * 
   * 🚨 주의: 사용되지 않음 (KIS API가 단일 소스)
   * 캐시 무효화만 수행
   */
  async removePosition(ticker: string, quantity: number): Promise<void> {
    // 캐시 무효화 (다음 조회 시 KIS API에서 최신 데이터 가져옴)
    this.lastPositionUpdate = null
    console.log(`📉 포지션 감소 (캐시 무효화): ${ticker} -${quantity}주`)
  }

  /**
   * 잔고 업데이트 (매수/매도 후)
   */
  async updateBalance(amount: number): Promise<void> {
    await pool.query(
      `UPDATE _ACCOUNT_BALANCE 
       SET ab_cash = ab_cash + ?, 
           ab_buying_power = ab_buying_power + ?,
           ab_updated_at = CURRENT_TIMESTAMP
       WHERE ab_account_no = ?`,
      [amount, amount, this.accountNo]
    )
    
    console.log(`💰 잔고 업데이트: ${amount >= 0 ? '+' : ''}$${amount}`)
  }

  /**
   * 캐시 무효화 (다음 조회 시 API 재호출)
   */
  async invalidateCache(): Promise<void> {
    this.lastBalanceUpdate = null
    this.lastPositionUpdate = null
    console.log('🔄 캐시 무효화 완료')
  }
}

export const accountCacheService = new AccountCacheService()

