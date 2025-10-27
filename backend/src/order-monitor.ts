// 예약 주문 및 익절/손절 감시 서비스
import { FMPApi } from './fmp-api'
import { KISApi } from './kis-api'
import {
  getPendingOrders,
  updatePendingOrderStatus,
  getMonitoredPositions,
  saveDBPosition,
  deleteDBPosition,
  reducePositionQuantity,
  updatePositionPrice,
  saveTradingRecord,
  type PendingOrder,
  type DBPosition
} from './db'

export class OrderMonitor {
  private fmpApi: FMPApi
  private kisApi: KISApi
  private isMarketOpen: boolean = false
  private monitorInterval: NodeJS.Timeout | null = null
  private marketCheckInterval: NodeJS.Timeout | null = null

  constructor(kisApi: KISApi, fmpApi: FMPApi) {
    this.kisApi = kisApi
    this.fmpApi = fmpApi
  }

  // 서비스 시작
  start() {
    console.log('🚀 주문 감시 서비스 시작')
    
    // 장 상태 체크 (1분마다)
    this.marketCheckInterval = setInterval(() => {
      this.checkMarketStatus()
    }, 60000)
    
    // 초기 장 상태 체크
    this.checkMarketStatus()
    
    // 익절/손절 감시 (10초마다)
    this.monitorInterval = setInterval(() => {
      this.monitorProfitLoss()
    }, 10000)
    
    console.log('✅ 주문 감시 서비스 실행 중')
  }

  // 서비스 중지
  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
    }
    if (this.marketCheckInterval) {
      clearInterval(this.marketCheckInterval)
    }
    console.log('⏹️ 주문 감시 서비스 중지')
  }

  // 미국 시장 오픈 여부 확인
  private checkMarketStatus() {
    const now = new Date()
    const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = nyTime.getDay() // 0=일요일, 6=토요일
    const hours = nyTime.getHours()
    const minutes = nyTime.getMinutes()
    const currentMinutes = hours * 60 + minutes

    const wasOpen = this.isMarketOpen

    // 주말 체크
    if (day === 0 || day === 6) {
      this.isMarketOpen = false
    } else {
      // 9:30 AM ~ 4:00 PM (EST)
      const marketOpen = 9 * 60 + 30 // 9:30 AM = 570분
      const marketClose = 16 * 60 // 4:00 PM = 960분
      this.isMarketOpen = currentMinutes >= marketOpen && currentMinutes < marketClose
    }

    // 장이 막 열렸을 때 예약 주문 실행
    if (!wasOpen && this.isMarketOpen) {
      console.log('🔔 미국 정규장 오픈 - 예약 주문 실행 시작')
      this.executePendingOrders()
    }
  }

  // 예약 주문 실행
  private async executePendingOrders() {
    try {
      const orders = await getPendingOrders()
      
      if (orders.length === 0) {
        console.log('📋 실행할 예약 주문 없음')
        return
      }

      console.log(`\n📋 예약 주문 ${orders.length}개 실행 시작\n`)

      for (const order of orders) {
        try {
          console.log(`\n🔄 예약 주문 처리: ${order.po_ticker} (${order.po_order_type})`)
          
          // 시장가 주문: 시초가로 즉시 체결
          if (order.po_price_type === 'market') {
            await this.executeMarketOrder(order)
          } 
          // 지정가 주문: 지정가로 주문 (체결 여부는 KIS API가 처리)
          else {
            await this.executeLimitOrder(order)
          }
          
          // 주문 상태 업데이트
          await updatePendingOrderStatus(order.po_id!, 'executed')
          console.log(`✅ 예약 주문 실행 완료: ${order.po_ticker}`)
          
        } catch (error: any) {
          console.error(`❌ 예약 주문 실행 실패 (${order.po_ticker}):`, error.message)
          await updatePendingOrderStatus(order.po_id!, 'failed', error.message)
        }
        
        // API 부하 방지를 위한 딜레이 (0.5초)
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      
      console.log(`\n✅ 예약 주문 실행 완료 (${orders.length}개)\n`)
    } catch (error) {
      console.error('❌ 예약 주문 처리 중 오류:', error)
    }
  }

  // 시장가 주문 실행 (시초가 즉시 체결)
  private async executeMarketOrder(order: PendingOrder) {
    // 현재가 조회 (장 오픈 직후이므로 시초가)
    const currentPrice = await this.fmpApi.getCurrentPrice(order.po_ticker)
    if (!currentPrice) {
      throw new Error('현재가 조회 실패')
    }

    console.log(`   💵 시장가 주문 - 현재가: $${currentPrice}`)

    if (order.po_order_type === 'buy') {
      // KIS API 매수
      await this.kisApi.buyStock(order.po_ticker, order.po_quantity, currentPrice)
      
      // DB에 포지션 추가
      await saveDBPosition({
        p_ticker: order.po_ticker,
        p_quantity: order.po_quantity,
        p_buy_price: currentPrice,
        p_current_price: currentPrice,
        p_profit_loss: 0,
        p_profit_loss_percent: 0,
        p_take_profit_enabled: order.po_take_profit_percent ? true : false,
        p_take_profit_percent: order.po_take_profit_percent,
        p_stop_loss_enabled: order.po_stop_loss_percent ? true : false,
        p_stop_loss_percent: order.po_stop_loss_percent
      })
      
      // 거래 이력 저장
      await saveTradingRecord({
        t_ticker: order.po_ticker,
        t_type: 'BUY',
        t_quantity: order.po_quantity,
        t_price: currentPrice,
        t_total_amount: currentPrice * order.po_quantity,
        t_status: 'COMPLETED',
        t_reason: order.po_reason || '예약 주문 실행 (시장가)'
      })
    } else {
      // KIS API 매도
      await this.kisApi.sellStock(order.po_ticker, order.po_quantity, currentPrice)
      
      // DB에서 포지션 수량 감소
      await reducePositionQuantity(order.po_ticker, order.po_quantity)
      
      // 거래 이력 저장
      await saveTradingRecord({
        t_ticker: order.po_ticker,
        t_type: 'SELL',
        t_quantity: order.po_quantity,
        t_price: currentPrice,
        t_total_amount: currentPrice * order.po_quantity,
        t_status: 'COMPLETED',
        t_reason: order.po_reason || '예약 주문 실행 (시장가)'
      })
    }
  }

  // 지정가 주문 실행
  private async executeLimitOrder(order: PendingOrder) {
    const limitPrice = order.po_limit_price!
    console.log(`   💵 지정가 주문 - 지정가: $${limitPrice}`)

    if (order.po_order_type === 'buy') {
      // KIS API 매수 (지정가)
      await this.kisApi.buyStock(order.po_ticker, order.po_quantity, limitPrice)
      
      // 체결 여부는 KIS API가 알아서 처리하므로, 일단 포지션 추가
      await saveDBPosition({
        p_ticker: order.po_ticker,
        p_quantity: order.po_quantity,
        p_buy_price: limitPrice,
        p_current_price: limitPrice,
        p_profit_loss: 0,
        p_profit_loss_percent: 0,
        p_take_profit_enabled: order.po_take_profit_percent ? true : false,
        p_take_profit_percent: order.po_take_profit_percent,
        p_stop_loss_enabled: order.po_stop_loss_percent ? true : false,
        p_stop_loss_percent: order.po_stop_loss_percent
      })
      
      // 거래 이력 저장
      await saveTradingRecord({
        t_ticker: order.po_ticker,
        t_type: 'BUY',
        t_quantity: order.po_quantity,
        t_price: limitPrice,
        t_total_amount: limitPrice * order.po_quantity,
        t_status: 'COMPLETED',
        t_reason: order.po_reason || '예약 주문 실행 (지정가)'
      })
    } else {
      // KIS API 매도 (지정가)
      await this.kisApi.sellStock(order.po_ticker, order.po_quantity, limitPrice)
      
      // DB에서 포지션 수량 감소
      await reducePositionQuantity(order.po_ticker, order.po_quantity)
      
      // 거래 이력 저장
      await saveTradingRecord({
        t_ticker: order.po_ticker,
        t_type: 'SELL',
        t_quantity: order.po_quantity,
        t_price: limitPrice,
        t_total_amount: limitPrice * order.po_quantity,
        t_status: 'COMPLETED',
        t_reason: order.po_reason || '예약 주문 실행 (지정가)'
      })
    }
  }

  // 익절/손절 감시
  private async monitorProfitLoss() {
    try {
      // DB에서 익절/손절 설정 조회
      let settingsFromDB: any[] = []
      try {
        settingsFromDB = await getMonitoredPositions()
      } catch (error: any) {
        // 테이블이 없으면 무시 (익절/손절 기능 비활성화)
        if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR') {
          return
        }
        throw error
      }
      
      if (settingsFromDB.length === 0) {
        return
      }

      console.log(`🔍 익절/손절 감시: ${settingsFromDB.length}개 설정`)

      for (const setting of settingsFromDB) {
        try {
          // KIS API에서 실제 포지션 조회
          const kisPositions = await this.kisApi.getBalance()
          if (!kisPositions || !kisPositions.output1) {
            continue
          }

          // 해당 티커의 실제 포지션 찾기
          const kisPosition = kisPositions.output1.find(
            (item: any) => item.ovrs_pdno === setting.p_ticker
          )

          if (!kisPosition) {
            // 포지션이 없으면 설정 삭제
            console.log(`⚠️ 포지션 없음, 설정 삭제: ${setting.p_ticker}`)
            await deleteDBPosition(setting.p_ticker)
            continue
          }

          const ticker = kisPosition.ovrs_pdno
          const quantity = parseInt(kisPosition.ovrs_cblc_qty || '0')
          const buyPrice = parseFloat(kisPosition.pchs_avg_pric || '0')
          const currentPrice = parseFloat(kisPosition.now_pric2 || '0')
          const profitLossPercent = parseFloat(kisPosition.evlu_pfls_rt || '0')

          // 익절 체크
          if (setting.p_take_profit_enabled && setting.p_take_profit_percent) {
            if (profitLossPercent >= setting.p_take_profit_percent) {
              console.log(`\n🎯 익절 조건 도달: ${ticker} (${profitLossPercent.toFixed(2)}% >= ${setting.p_take_profit_percent}%)`)
              await this.executeProfitTake(ticker, quantity, currentPrice, profitLossPercent, setting.p_take_profit_percent)
              continue
            }
          }

          // 손절 체크
          if (setting.p_stop_loss_enabled && setting.p_stop_loss_percent) {
            if (profitLossPercent <= -setting.p_stop_loss_percent) {
              console.log(`\n🛑 손절 조건 도달: ${ticker} (${profitLossPercent.toFixed(2)}% <= -${setting.p_stop_loss_percent}%)`)
              await this.executeStopLoss(ticker, quantity, currentPrice, profitLossPercent, setting.p_stop_loss_percent)
              continue
            }
          }
          
          // API 부하 방지를 위한 딜레이 (0.5초)
          await new Promise(resolve => setTimeout(resolve, 500))
        } catch (error) {
          console.error(`❌ 포지션 감시 중 오류 (${setting.p_ticker}):`, error)
        }
      }
    } catch (error) {
      console.error('❌ 익절/손절 감시 중 오류:', error)
    }
  }

  // 익절 실행
  private async executeProfitTake(
    ticker: string,
    quantity: number,
    currentPrice: number,
    profitLossPercent: number,
    targetPercent: number
  ) {
    try {
      // KIS API 전량 매도
      await this.kisApi.sellStock(ticker, quantity, currentPrice)
      
      // 거래 이력 저장
      await saveTradingRecord({
        t_ticker: ticker,
        t_type: 'SELL',
        t_quantity: quantity,
        t_price: currentPrice,
        t_total_amount: currentPrice * quantity,
        t_profit_loss_rate: profitLossPercent,
        t_status: 'COMPLETED',
        t_reason: `익절 (목표: ${targetPercent}%, 실현: ${profitLossPercent.toFixed(2)}%)`
      })
      
      // 익절/손절 설정 삭제
      await deleteDBPosition(ticker)
      
      console.log(`✅ 익절 완료: ${ticker} (${profitLossPercent.toFixed(2)}%)`)
    } catch (error) {
      console.error(`❌ 익절 실행 실패 (${ticker}):`, error)
    }
  }

  // 손절 실행
  private async executeStopLoss(
    ticker: string,
    quantity: number,
    currentPrice: number,
    profitLossPercent: number,
    targetPercent: number
  ) {
    try {
      // KIS API 전량 매도
      await this.kisApi.sellStock(ticker, quantity, currentPrice)
      
      // 거래 이력 저장
      await saveTradingRecord({
        t_ticker: ticker,
        t_type: 'SELL',
        t_quantity: quantity,
        t_price: currentPrice,
        t_total_amount: currentPrice * quantity,
        t_profit_loss_rate: profitLossPercent,
        t_status: 'COMPLETED',
        t_reason: `손절 (목표: -${targetPercent}%, 실현: ${profitLossPercent.toFixed(2)}%)`
      })
      
      // 익절/손절 설정 삭제
      await deleteDBPosition(ticker)
      
      console.log(`✅ 손절 완료: ${ticker} (${profitLossPercent.toFixed(2)}%)`)
    } catch (error) {
      console.error(`❌ 손절 실행 실패 (${ticker}):`, error)
    }
  }
}

