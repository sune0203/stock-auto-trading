/**
 * KIS API 동기화 서비스
 * - 주기적으로 KIS API에서 보유 포지션, 미체결 주문, 거래내역을 조회하여 DB와 동기화
 */

import { kisApiManager } from './kis-api-manager.js'
import { saveTradingRecord, savePendingOrder, updatePendingOrderStatus, getTradingHistory, type TradingRecord, type PendingOrder } from './db.js'
import { accountCacheService } from './account-cache.js'

class KISSyncService {
  private syncInterval: NodeJS.Timeout | null = null
  private isSyncing = false
  private readonly SYNC_INTERVAL = 300000 // 5분마다 동기화

  /**
   * 동기화 서비스 시작
   */
  start() {
    console.log('🔄 KIS 동기화 서비스 시작')
    
    // 초기 동기화 (5초 후)
    setTimeout(() => {
      this.syncAll()
    }, 5000)
    
    // 주기적 동기화
    this.syncInterval = setInterval(() => {
      this.syncAll()
    }, this.SYNC_INTERVAL)
  }

  /**
   * 동기화 서비스 중지
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
      console.log('⏸️ KIS 동기화 서비스 중지')
    }
  }

  /**
   * 전체 동기화 실행
   */
  private async syncAll() {
    if (this.isSyncing) {
      console.log('⚠️ 이미 동기화 중입니다')
      return
    }

    this.isSyncing = true
    console.log('🔄 KIS 데이터 동기화 시작...')

    try {
      // 1. 잔고 갱신 (캐시 무효화)
      await this.syncBalance()
      
      // ⏱️ Rate Limit 방지: 3초 대기
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      // 2. 보유 포지션 갱신
      await this.syncPositions()
      
      // ⏱️ Rate Limit 방지: 3초 대기
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      // 3. 미체결 주문 동기화 (현재 KIS API에서 미지원이므로 스킵)
      // await this.syncUnexecutedOrders()
      
      // 4. 최근 거래내역 동기화 (KIS API에서 조회하여 DB에 저장)
      await this.syncTradingHistory()
      
      console.log('✅ KIS 데이터 동기화 완료')
    } catch (error) {
      console.error('❌ KIS 동기화 실패:', error)
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * 잔고 동기화
   */
  private async syncBalance() {
    try {
      console.log('💰 잔고 동기화 중...')
      
      // 캐시 무효화하여 최신 데이터 조회
      accountCacheService.invalidateCache()
      const balance = await accountCacheService.getBalance()
      
      if (balance) {
        console.log(`✅ 잔고 동기화 완료: $${balance.buyingPower.toFixed(2)}`)
      } else {
        console.log('⚠️ 잔고 동기화 실패')
      }
    } catch (error) {
      console.error('❌ 잔고 동기화 오류:', error)
    }
  }

  /**
   * 보유 포지션 동기화
   */
  private async syncPositions() {
    try {
      console.log('📊 보유 포지션 동기화 중...')
      
      // 캐시 무효화하여 최신 데이터 조회
      const positions = await accountCacheService.getPositions()
      
      console.log(`✅ 보유 포지션 동기화 완료: ${positions.length}개`)
      
      // 포지션 요약 로그
      if (positions.length > 0) {
        const tickers = positions.map(p => p.ticker).join(', ')
        console.log(`   보유 종목: ${tickers}`)
      }
    } catch (error) {
      console.error('❌ 보유 포지션 동기화 오류:', error)
    }
  }

  /**
   * 미체결 주문 동기화
   * 
   * 주의: KIS API의 "미체결내역조회" 엔드포인트는 현재 백엔드에 구현되지 않음
   * 향후 구현 시 사용
   */
  private async syncUnexecutedOrders() {
    try {
      console.log('⏰ 미체결 주문 동기화 중...')
      
      // TODO: KIS API에서 미체결 주문 조회
      // const unexecutedOrders = await kisApiManager.getUnexecutedOrders()
      
      // TODO: DB의 pending orders와 비교하여 상태 업데이트
      // - KIS에서 체결 완료된 주문 → DB에서 'executed'로 업데이트
      // - KIS에서 취소된 주문 → DB에서 'cancelled'로 업데이트
      
      console.log('⚠️ 미체결 주문 동기화는 현재 미구현')
    } catch (error) {
      console.error('❌ 미체결 주문 동기화 오류:', error)
    }
  }

  /**
   * 거래내역 동기화
   * KIS API에서 최근 30일 거래내역을 조회하여 DB에 저장
   */
  private async syncTradingHistory() {
    try {
      console.log('📜 거래내역 동기화 중...')
      
      const currentAccount = kisApiManager.getCurrentAccount()
      if (!currentAccount) {
        console.log('⚠️ 활성 계정이 없습니다')
        return
      }
      
      // 최근 30일 조회
      const endDate = new Date().toISOString().split('T')[0] // YYYY-MM-DD
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      
      const historyData = await kisApiManager.getTradingHistory(startDate, endDate)
      
      if (!historyData || !historyData.output || historyData.output.length === 0) {
        console.log('📭 KIS에서 조회된 거래내역 없음')
        return
      }
      
      // KIS API 응답 파싱
      const kisHistory = historyData.output as any[]
      console.log(`📥 KIS에서 ${kisHistory.length}개 거래내역 조회`)
      
      // 🔍 첫 번째 항목의 전체 필드 출력 (디버깅)
      if (kisHistory.length > 0) {
        console.log(`🔍 KIS API 응답 샘플:`)
        console.log(JSON.stringify(kisHistory[0], null, 2))
      }
      
      // DB 기존 데이터 한 번만 조회 (성능 최적화)
      const existingHistory = await getTradingHistory(1000, currentAccount.ka_type)
      console.log(`💾 DB 기존 거래내역: ${existingHistory.length}개`)
      
      // DB에 저장 (중복 체크 필요)
      let savedCount = 0
      let skippedCount = 0
      
      for (const item of kisHistory) {
        try {
          // ✅ KIS API 실제 필드명 사용
          const quantity = parseFloat(item.ft_ccld_qty || '0') // 체결수량
          const price = parseFloat(item.ft_ccld_unpr3 || '0') // 체결단가
          const amount = parseFloat(item.ft_ccld_amt3 || '0') // 체결금액
          const nccsQty = parseFloat(item.nccs_qty || '0') // 미체결수량
          const orderType = item.sll_buy_dvsn_cd === '02' ? 'buy' : 'sell'
          const ordDateFormatted = item.ord_dt?.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') || ''
          
          // 🔍 필드 디버깅 (첫 번째 항목만)
          if (savedCount === 0 && skippedCount === 0) {
            console.log(`📋 미체결수량: ${nccsQty}`)
            console.log(`📋 체결수량: ${quantity}`)
            console.log(`📋 체결단가: $${price}`)
            console.log(`📋 체결금액: $${amount}`)
            console.log(`📅 ord_dt: ${item.ord_dt}, dmst_ord_dt: ${item.dmst_ord_dt}`)
            console.log(`⏰ ord_tmd: ${item.ord_tmd}, thco_ord_tmd: ${item.thco_ord_tmd}`)
          }
          
          // 미체결 주문은 저장하지 않음
          if (nccsQty > 0) {
            console.log(`   ⏭️ 미체결 주문 스킵: ${item.pdno} (미체결: ${nccsQty}주)`)
            skippedCount++
            continue
          }
          
          // 체결수량이 0이면 스킵
          if (quantity <= 0) {
            console.log(`   ⏭️ 체결수량 0 스킵: ${item.pdno}`)
            skippedCount++
            continue
          }
          
          // 🔒 강력한 중복 체크: 주문번호(odno) 사용
          const orderNumber = item.odno || ''
          
          // 방법 1: 주문번호로 중복 체크 (가장 정확)
          let isDuplicate = false
          if (orderNumber) {
            isDuplicate = existingHistory.some(e => 
              e.th_reason?.includes(orderNumber)
            )
          }
          
          // 방법 2: 주문번호가 없으면 상세 정보로 중복 체크
          if (!isDuplicate) {
            isDuplicate = existingHistory.some(e => {
              // th_timestamp가 Date 객체이면 문자열로 변환
              const timestampStr = e.th_timestamp instanceof Date 
                ? e.th_timestamp.toISOString().split('T')[0] 
                : String(e.th_timestamp || '').split('T')[0].split(' ')[0]
              
              return e.th_ticker === item.pdno &&
                e.th_type?.toLowerCase() === orderType &&
                Math.abs(e.th_quantity - quantity) < 0.01 &&
                Math.abs(e.th_price - price) < 0.01 &&
                timestampStr === ordDateFormatted
            })
          }
          
          if (isDuplicate) {
            console.log(`   ⏭️ 중복 거래 스킵: ${item.pdno} ${orderType.toUpperCase()} ${quantity}주 @ $${price.toFixed(2)}`)
            skippedCount++
            continue
          }
          
          // 날짜 파싱 (YYYYMMDD + HHMMSS → YYYY-MM-DD HH:MM:SS)
          // dmst_ord_dt: 국내주문일자 (YYYYMMDD)
          // thco_ord_tmd: 당사주문시각 (HHMMSS) - 한국시간 기준
          const ordDate = item.dmst_ord_dt || item.ord_dt || ''
          const ordTime = item.thco_ord_tmd || item.ord_tmd || '000000'
          const timestamp = `${ordDate.slice(0,4)}-${ordDate.slice(4,6)}-${ordDate.slice(6,8)} ${ordTime.slice(0,2)}:${ordTime.slice(2,4)}:${ordTime.slice(4,6)}`
          
          // 새로운 거래 저장
          const recordToSave = {
            t_account_type: currentAccount.ka_type,
            t_ticker: item.pdno, // 종목코드
            t_type: orderType, // buy or sell
            t_price: price, // 체결단가
            t_quantity: quantity, // 체결수량
            t_total_amount: amount, // 체결금액 (수정됨)
            t_profit_loss: null,
            t_profit_loss_rate: null,
            t_reason: `KIS API 동기화 (주문번호: ${orderNumber})`, // 주문번호 포함
            t_executed_at: new Date(timestamp)
          }
          
          // 🔍 저장할 데이터 로그 (첫 번째만)
          if (savedCount === 0) {
            console.log(`💾 저장할 데이터:`, JSON.stringify(recordToSave, null, 2))
          }
          
          await saveTradingRecord(recordToSave)
          
          savedCount++
          console.log(`   ✅ ${savedCount}. ${item.pdno} ${orderType.toUpperCase()} ${quantity}주 @ $${price.toFixed(2)} = $${amount.toFixed(2)}`)
        } catch (error) {
          console.error(`   ⚠️ 거래내역 저장 실패 (${item.pdno}):`, error)
        }
      }
      
      console.log(`📊 동기화 결과: 저장 ${savedCount}개, 스킵 ${skippedCount}개, 총 ${kisHistory.length}개`)
      
      if (savedCount > 0) {
        console.log(`✅ 거래내역 동기화 완료: ${savedCount}개 저장`)
      } else if (skippedCount > 0) {
        console.log(`⚠️ 모든 거래내역이 중복 또는 미체결`)
      } else {
        console.log(`⚠️ 저장 가능한 거래내역 없음`)
      }
    } catch (error) {
      console.error('❌ 거래내역 동기화 오류:', error)
    }
  }

  /**
   * 수동 동기화 트리거 (API 엔드포인트에서 호출)
   */
  async manualSync() {
    console.log('🔄 수동 동기화 요청')
    await this.syncAll()
  }
}

// 싱글톤 인스턴스
export const kisSyncService = new KISSyncService()

