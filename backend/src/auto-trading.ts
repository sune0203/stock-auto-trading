// 자동 매수 서비스
import { pool, NewsFromDB } from './db.js'
import { kisApiManager } from './kis-api-manager.js'
import { accountCacheService } from './account-cache.js'
import { saveTradingRecord } from './db.js'

interface ProcessedNews {
  n_idx: number
  processed_at: Date
}

export class AutoTradingService {
  private processedNews: Set<number> = new Set()
  private checkInterval: NodeJS.Timeout | null = null
  private isRunning = false

  // 자동 매수 시작
  start() {
    if (this.isRunning) {
      console.log('⚠️ 자동 매수 서비스가 이미 실행 중입니다')
      return
    }

    console.log('🤖 자동 매수 서비스 시작')
    this.isRunning = true
    
    // 즉시 실행
    this.checkHighScoreNews()
    
    // 30초마다 체크
    this.checkInterval = setInterval(() => {
      this.checkHighScoreNews()
    }, 30000)
  }

  // 자동 매수 중지
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    this.isRunning = false
    console.log('🛑 자동 매수 서비스 중지')
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
         AND (n_bullish >= 95 OR n_immediate_impact >= 95)
         AND n_in_time >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)
         ORDER BY n_in_time DESC`
      )

      const news = rows as NewsFromDB[]

      // 새로운 뉴스가 없으면 로그 출력 안 함
      if (news.length === 0) {
        return
      }

      for (const item of news) {
        // 이미 처리한 뉴스는 건너뛰기
        if (this.processedNews.has(item.n_idx)) {
          continue
        }

        // 점수 확인
        const bullishScore = item.n_bullish || 0
        const impactScore = item.n_immediate_impact || 0

        if (bullishScore >= 95 || impactScore >= 95) {
          console.log(`\n🎯 높은 점수 뉴스 감지!`)
          console.log(`  종목: ${item.n_ticker}`)
          console.log(`  제목: ${item.n_title_kr || item.n_title}`)
          console.log(`  호재점수: ${bullishScore}%`)
          console.log(`  당일상승점수: ${impactScore}%`)
          console.log(`  입력시간: ${item.n_in_time}`)

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
    } catch (error) {
      console.error('❌ 자동 매수 체크 실패:', error)
    }
  }

  // 자동 매수 실행
  private async executeAutoBuy(news: NewsFromDB, bullishScore: number, impactScore: number) {
    try {
      const ticker = news.n_ticker!

      // 1. 현재 잔고 조회
      const balance = await accountCacheService.getBalance()
      const buyingPower = balance.cash || 0

      if (buyingPower <= 0) {
        console.log('❌ 매수 가능 금액이 없습니다')
        return
      }

      // 2. 투자 금액 계산 (잔고의 10%)
      const investAmount = buyingPower * 0.1

      console.log(`💰 현재 잔고: $${buyingPower.toFixed(2)}`)
      console.log(`💰 투자 금액 (10%): $${investAmount.toFixed(2)}`)

      // 3. 현재 주가 조회 (FMP API)
      const fmpApiKey = process.env.FMP_API_KEY
      if (!fmpApiKey) {
        console.error('❌ FMP API 키가 설정되지 않았습니다')
        return
      }

      const priceResponse = await fetch(
        `https://financialmodelingprep.com/api/v3/quote-short/${ticker}?apikey=${fmpApiKey}`
      )
      const priceData = await priceResponse.json()

      if (!priceData || priceData.length === 0) {
        console.error('❌ 주가 조회 실패:', ticker)
        return
      }

      const currentPrice = priceData[0].price

      // 4. 매수 수량 계산
      const quantity = Math.floor(investAmount / currentPrice)

      if (quantity <= 0) {
        console.log('❌ 매수 가능 수량이 없습니다 (주가가 너무 높음)')
        return
      }

      console.log(`📊 현재가: $${currentPrice.toFixed(2)}`)
      console.log(`📊 매수 수량: ${quantity}주`)
      console.log(`📊 총 금액: $${(currentPrice * quantity).toFixed(2)}`)

      // 5. KIS API로 매수 주문
      console.log(`\n🚀 자동 매수 주문 실행 중...`)
      
      const orderResult = await kisApiManager.buyStock(
        ticker,
        quantity,
        currentPrice
      )

      if (orderResult.success) {
        console.log(`✅ 자동 매수 성공!`)
        console.log(`  주문번호: ${orderResult.orderNumber}`)

        // 6. 거래 기록 저장
        await saveTradingRecord({
          t_ticker: ticker,
          t_account_type: 'REAL',
          t_type: 'BUY',
          t_price: currentPrice,
          t_quantity: quantity,
          t_total_amount: currentPrice * quantity,
          t_order_id: orderResult.orderNumber,
          t_status: 'COMPLETED',
          t_reason: `자동매수 (호재:${bullishScore}%, 당일상승:${impactScore}%)`,
          t_news_idx: news.n_idx,
          t_executed_at: new Date()
        })

        // 7. 캐시 무효화 (잔고 및 포지션 갱신)
        const account = kisApiManager.getCurrentAccount()
        if (account) {
          accountCacheService.onAccountSwitch(account.ka_type, account.ka_account_no)
        }

        console.log(`📝 거래 기록 저장 완료`)
      } else {
        console.error(`❌ 자동 매수 실패:`, orderResult.message)
      }

    } catch (error) {
      console.error('❌ 자동 매수 실행 실패:', error)
    }
  }

  // 처리된 뉴스 개수 조회
  getProcessedNewsCount(): number {
    return this.processedNews.size
  }

  // 서비스 상태 조회
  getStatus(): { isRunning: boolean; processedCount: number } {
    return {
      isRunning: this.isRunning,
      processedCount: this.processedNews.size
    }
  }
}

// 싱글톤 인스턴스
export const autoTradingService = new AutoTradingService()

