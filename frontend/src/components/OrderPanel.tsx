import React, { useState, useEffect } from 'react'
import axios from 'axios'
import './OrderPanel.css'

interface OrderPanelProps {
  symbol: string
  currentPrice: number
  exchangeRate: number
  balance?: number // 매수가능금액
  currentHolding?: number // 현재 보유 수량
  onOrderComplete?: () => void // 주문 완료 콜백
  initialPrice?: number // 초기 가격 (호가 클릭 시)
  initialOrderType?: 'buy' | 'sell' // 초기 주문 타입
  initialPriceType?: 'market' | 'limit' // 초기 가격 타입
}

const OrderPanel: React.FC<OrderPanelProps> = ({ 
  symbol, 
  currentPrice, 
  exchangeRate, 
  balance = 0,
  currentHolding = 0,
  onOrderComplete,
  initialPrice,
  initialOrderType,
  initialPriceType
}) => {
  const [orderType, setOrderType] = useState<'buy' | 'sell'>(initialOrderType || 'buy')
  const [priceType, setPriceType] = useState<'market' | 'limit'>(initialPriceType || 'market') // 시장가/지정가
  const [quantity, setQuantity] = useState<number>(1)
  const [limitPrice, setLimitPrice] = useState<number>(initialPrice || currentPrice)
  const [loading, setLoading] = useState(false)
  const [takeProfitPercent, setTakeProfitPercent] = useState<number>(0) // 익절 %
  const [stopLossPercent, setStopLossPercent] = useState<number>(0) // 손절 %
  const [takeProfitEnabled, setTakeProfitEnabled] = useState<boolean>(false) // 익절 활성화
  const [stopLossEnabled, setStopLossEnabled] = useState<boolean>(false) // 손절 활성화
  const [accountType, setAccountType] = useState<'REAL' | 'VIRTUAL' | null>(null) // 계정 타입
  const [pendingSellQuantity, setPendingSellQuantity] = useState<number>(0) // 대기 중 매도 수량

  // 현재 계정 정보 로드
  useEffect(() => {
    const loadAccountInfo = async () => {
      try {
        const response = await axios.get('http://localhost:3001/api/accounts/current')
        setAccountType(response.data.ka_type)
      } catch (error) {
        console.error('계정 정보 조회 실패:', error)
      }
    }
    loadAccountInfo()
  }, [])

  // 대기 중인 매도 주문 수량 조회
  useEffect(() => {
    const loadPendingOrders = async () => {
      if (!symbol) return

      try {
        const response = await axios.get('http://localhost:3001/api/trading/pending-orders')
        const pendingOrders = response.data || []
        
        // 현재 종목의 대기 중 매도 주문 수량 합산
        const sellQuantity = pendingOrders
          .filter((order: any) => 
            order.po_ticker === symbol && 
            order.po_order_type === 'sell' && 
            order.po_status === 'pending'
          )
          .reduce((sum: number, order: any) => sum + order.po_quantity, 0)
        
        setPendingSellQuantity(sellQuantity)
      } catch (error) {
        console.error('대기 주문 조회 실패:', error)
        setPendingSellQuantity(0)
      }
    }

    loadPendingOrders()
    
    // 10초마다 자동 갱신
    const interval = setInterval(loadPendingOrders, 10000) // 10초마다 갱신
    return () => clearInterval(interval)
  }, [symbol])

  // 호가 클릭으로 가격이 설정되면 지정가 모드로 전환
  useEffect(() => {
    if (initialPrice && initialPrice !== currentPrice) {
      setPriceType('limit')
      setLimitPrice(initialPrice)
    }
  }, [initialPrice, currentPrice])

  // 초기 주문 타입 반영
  useEffect(() => {
    if (initialOrderType) {
      setOrderType(initialOrderType)
    }
  }, [initialOrderType])

  // 초기 가격 타입 반영
  useEffect(() => {
    if (initialPriceType) {
      setPriceType(initialPriceType)
    }
  }, [initialPriceType])

  const effectivePrice = priceType === 'market' ? currentPrice : limitPrice
  const totalPrice = effectivePrice * quantity
  const totalPriceKRW = totalPrice * exchangeRate
  
  // 매수가능 수량 계산
  const maxBuyableQty = currentPrice > 0 ? Math.floor(balance / currentPrice) : 0
  
  // 매도가능 수량 = 전체 보유 - 대기 중 매도
  const maxSellableQty = currentHolding - pendingSellQuantity

  // 미국 시장 오픈 여부 확인
  const isMarketOpen = () => {
    const now = new Date()
    const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = nyTime.getDay() // 0=일요일, 6=토요일
    const hours = nyTime.getHours()
    const minutes = nyTime.getMinutes()
    const currentMinutes = hours * 60 + minutes

    console.log(`🕐 시장 오픈 체크: EST ${hours}:${minutes.toString().padStart(2, '0')} (${day === 0 ? '일' : day === 6 ? '토' : '평일'})`)

    // 주말 체크
    if (day === 0 || day === 6) {
      console.log('❌ 시장 닫힘: 주말')
      return false
    }

    // 9:30 AM ~ 4:00 PM (EST)
    const marketOpen = 9 * 60 + 30 // 9:30 AM = 570분
    const marketClose = 16 * 60 // 4:00 PM = 960분

    const isOpen = currentMinutes >= marketOpen && currentMinutes < marketClose
    console.log(`${isOpen ? '✅' : '❌'} 시장 ${isOpen ? '오픈' : '닫힘'}: ${currentMinutes}분 (오픈: ${marketOpen}~${marketClose})`)
    
    return isOpen
  }

  const handleOrder = async () => {
    if (!symbol || currentPrice === 0) {
      alert('종목 정보를 불러오는 중입니다.')
      return
    }

    if (quantity <= 0) {
      alert('수량을 입력해주세요.')
      return
    }

    // 시장 오픈 체크 - 자동으로 백엔드에서 예약 주문으로 전환
    // (사용자는 알 필요 없음 - 백엔드가 자동 처리)
    if (!isMarketOpen()) {
      console.log('⏰ 장 마감: 백엔드에서 자동으로 예약 주문으로 전환됩니다')
    }

    // 매수 시 잔고 확인
    if (orderType === 'buy') {
      const orderPrice = priceType === 'market' ? currentPrice : limitPrice
      const requiredAmount = orderPrice * quantity
      
      if (requiredAmount > balance) {
        alert(`💰 잔고가 부족합니다.\n\n필요 금액: $${requiredAmount.toLocaleString()}\n보유 잔고: $${balance.toLocaleString()}\n부족 금액: $${(requiredAmount - balance).toLocaleString()}`)
        return
      }
    }

    setLoading(true)
    try {
      // 시장가 주문: FMP 실시간 가격 사용
      // 지정가 주문: 사용자가 입력한 가격 사용
      const orderPrice = priceType === 'market' ? currentPrice : limitPrice

      const endpoint = orderType === 'buy' 
        ? '/api/trading/manual-buy' 
        : '/api/trading/sell'

      const response = await axios.post(`http://localhost:3001${endpoint}`, {
        ticker: symbol,
        quantity,
        price: orderPrice,
        orderType: priceType, // 'market' or 'limit'
        currentPrice: currentPrice, // FMP 실시간 가격
        newsTitle: `${priceType === 'market' ? '시장가' : '지정가'} 주문`,
        takeProfitPercent: takeProfitEnabled && takeProfitPercent > 0 ? takeProfitPercent : undefined,
        stopLossPercent: stopLossEnabled && stopLossPercent > 0 ? stopLossPercent : undefined
      })

      // 백엔드 응답에 따라 알림 메시지 표시
      const isReservation = response.data.reservation || false
      
      alert(
        `${isReservation ? '[예약 주문] ' : ''}${orderType === 'buy' ? '매수' : '매도'} 주문이 완료되었습니다.\n` +
        `가격: $${orderPrice.toFixed(2)}\n` +
        `수량: ${quantity}주` +
        `${isReservation ? '\n\n※ 장 시작 시 자동 실행됩니다' : ''}`
      )
      
      console.log(`✅ [프론트] 주문 성공 - ${orderType} ${symbol} ${quantity}주 @ $${orderPrice}`)
      
      setQuantity(1)
      
      // 대기 중 수량 즉시 갱신 (매도 예약 주문인 경우)
      if (isReservation && orderType === 'sell') {
        setPendingSellQuantity(prev => prev + quantity)
        console.log(`📊 [프론트] 대기 중 매도 수량 갱신: +${quantity}주`)
      }
      
      // 주문 완료 후 콜백 실행 (잔고 및 포지션 갱신)
      console.log(`🔄 [프론트] onOrderComplete 콜백 호출 시작`)
      if (onOrderComplete) {
        onOrderComplete()
        console.log(`✓ [프론트] onOrderComplete 콜백 완료`)
      } else {
        console.warn(`⚠️ [프론트] onOrderComplete 콜백이 정의되지 않음`)
      }
      
      // 주문 완료 후 미체결/체결 내역 조회 (백엔드로 확인)
      setTimeout(async () => {
        try {
          console.log(`🔍 [프론트] 주문 후 미체결/체결 내역 조회 시작`)
          const [unexecuted, history] = await Promise.all([
            axios.get('http://localhost:3001/api/trading/unexecuted-orders'),
            axios.get('http://localhost:3001/api/trading/order-history?days=1')
          ])
          
          if (unexecuted.data.success) {
            console.log(`📋 미체결 주문: ${unexecuted.data.orders.length}건`)
          }
          
          if (history.data.success) {
            console.log(`📜 체결 내역: ${history.data.orders.length}건`)
          }
        } catch (error) {
          console.error('주문 내역 조회 실패:', error)
        }
      }, 1000) // 1초 후 조회 (KIS API 반영 대기)
    } catch (error: any) {
      console.error('❌ [프론트] 주문 실패:', error)
      console.error('   에러 응답:', error.response?.data)
      console.error('   에러 메시지:', error.message)
      const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message || '주문에 실패했습니다.'
      alert(`주문 실패: ${errorMsg}`)
    } finally {
      setLoading(false)
    }
  }
  
  // 수량 퍼센트 버튼 (10%, 20%, ..., 100% - 총 10개)
  const setQuantityByPercent = (percent: number) => {
    const maxQty = orderType === 'buy' ? maxBuyableQty : maxSellableQty
    
    if (maxQty > 0) {
      if (percent === 100) {
        setQuantity(maxQty)
      } else {
        setQuantity(Math.max(1, Math.floor(maxQty * (percent / 100))))
      }
    }
  }

  return (
    <div className="order-panel">
      <div className="order-header">
        <div className="order-header-left">
          <h3>주문</h3>
          {accountType && (
            <span className={`account-type-badge ${accountType === 'REAL' ? 'real' : 'virtual'}`}>
              {accountType === 'REAL' ? '🔴 실전투자' : '🟢 모의투자'}
            </span>
          )}
        </div>
        <div className="order-header-right">
          <div className="order-symbol">
            <span className="symbol-label">종목</span>
            <span className="symbol-value">{symbol}</span>
          </div>
        </div>
      </div>

      {/* 매수/매도 탭 */}
      <div className="order-tabs">
        <button
          className={`order-tab ${orderType === 'buy' ? 'active buy' : ''}`}
          onClick={() => setOrderType('buy')}
        >
          매수
        </button>
        <button
          className={`order-tab ${orderType === 'sell' ? 'active sell' : ''}`}
          onClick={() => setOrderType('sell')}
        >
          매도
        </button>
      </div>

      {/* 주문 정보 */}
      <div className="order-content">

        {/* 시장가/지정가 선택 */}
        <div className="price-type-tabs">
          <button
            className={`price-type-tab ${priceType === 'market' ? 'active' : ''}`}
            onClick={() => setPriceType('market')}
          >
            시장가
          </button>
          <button
            className={`price-type-tab ${priceType === 'limit' ? 'active' : ''}`}
            onClick={() => {
              setPriceType('limit')
              setLimitPrice(currentPrice)
            }}
          >
            지정가
          </button>
        </div>

        <div className="order-field">
          <label className="field-label">현재가</label>
          <div className="field-value price-value">
            ${currentPrice.toFixed(2)}
            <span className="price-krw">
              {(currentPrice * exchangeRate).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원
            </span>
          </div>
        </div>

        {/* 보유/대기 수량 표시 */}
        {currentHolding > 0 && (
          <div className="holding-info">
            <div className="holding-row">
              <span className="holding-label">전체 보유</span>
              <span className="holding-value total">{currentHolding}주</span>
            </div>
            {pendingSellQuantity > 0 && (
              <>
                <div className="holding-row">
                  <span className="holding-label">매도 대기</span>
                  <span className="holding-value pending">-{pendingSellQuantity}주</span>
                </div>
                <div className="holding-row available">
                  <span className="holding-label">판매 가능</span>
                  <span className="holding-value">{currentHolding - pendingSellQuantity}주</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* 지정가 입력 */}
        {priceType === 'limit' && (
          <div className="order-field">
            <label className="field-label">주문가격</label>
            <div className="price-input-group">
              <button
                className="price-btn"
                onClick={() => setLimitPrice(Math.max(0.01, limitPrice - 0.01))}
              >
                -
              </button>
              <input
                type="number"
                className="price-input"
                value={limitPrice.toFixed(2)}
                onChange={(e) => setLimitPrice(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                step="0.01"
                min="0.01"
              />
              <button
                className="price-btn"
                onClick={() => setLimitPrice(limitPrice + 0.01)}
              >
                +
              </button>
            </div>
          </div>
        )}

        <div className="order-field">
          <label className="field-label">수량</label>
          <div className="quantity-input-group">
            <button
              className="quantity-btn"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
            >
              -
            </button>
            <input
              type="number"
              className="quantity-input"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              min="1"
            />
            <button
              className="quantity-btn"
              onClick={() => setQuantity(quantity + 1)}
            >
              +
            </button>
          </div>
        </div>

        {/* 빠른 수량 선택 (10% ~ 100% 버튼) */}
        <div className="quick-amounts">
          {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(percent => (
            <button
              key={percent}
              className={`quick-amount-btn ${percent === 100 ? 'max' : ''}`}
              onClick={() => setQuantityByPercent(percent)}
              disabled={orderType === 'buy' ? maxBuyableQty === 0 : maxSellableQty === 0}
            >
              {percent === 100 ? '최대' : `${percent}%`}
            </button>
          ))}
        </div>

        {/* 익절/손절 설정 - 매수일 때만 표시 */}
        {orderType === 'buy' && (
          <div className="profit-loss-settings">
            <div className="pl-row">
              <div className="pl-checkbox-wrapper">
                <input
                  type="checkbox"
                  id="takeProfitEnabled"
                  className="pl-checkbox"
                  checked={takeProfitEnabled}
                  onChange={(e) => setTakeProfitEnabled(e.target.checked)}
                />
                <label htmlFor="takeProfitEnabled" className="pl-label">익절 %</label>
              </div>
              <input
                type="number"
                className="pl-input"
                value={takeProfitPercent}
                onChange={(e) => setTakeProfitPercent(Math.max(0, parseFloat(e.target.value) || 0))}
                placeholder="0"
                step="0.5"
                min="0"
                disabled={!takeProfitEnabled}
              />
              {takeProfitEnabled && takeProfitPercent > 0 && (
                <span className="pl-preview profit">
                  ${(effectivePrice * (1 + takeProfitPercent / 100)).toFixed(2)}
                </span>
              )}
            </div>
            <div className="pl-row">
              <div className="pl-checkbox-wrapper">
                <input
                  type="checkbox"
                  id="stopLossEnabled"
                  className="pl-checkbox"
                  checked={stopLossEnabled}
                  onChange={(e) => setStopLossEnabled(e.target.checked)}
                />
                <label htmlFor="stopLossEnabled" className="pl-label">손절 %</label>
              </div>
              <input
                type="number"
                className="pl-input"
                value={stopLossPercent}
                onChange={(e) => setStopLossPercent(Math.max(0, parseFloat(e.target.value) || 0))}
                placeholder="0"
                step="0.5"
                min="0"
                disabled={!stopLossEnabled}
              />
              {stopLossEnabled && stopLossPercent > 0 && (
                <span className="pl-preview loss">
                  ${(effectivePrice * (1 - stopLossPercent / 100)).toFixed(2)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 총 금액 */}
        <div className="order-summary">
          <div className="summary-row">
            <span className="summary-label">주문 금액</span>
            <span className="summary-value">
              ${totalPrice.toFixed(2)}
            </span>
          </div>
          <div className="summary-row krw">
            <span className="summary-label">약</span>
            <span className="summary-value">
              {totalPriceKRW.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원
            </span>
          </div>
          {orderType === 'buy' && (
            <div className="summary-row max-qty">
              <span className="summary-label">매수가능</span>
              <span className="summary-value max-qty-value">
                최대 {maxBuyableQty}주
              </span>
            </div>
          )}
          {orderType === 'sell' && (
            <div className="summary-row max-qty">
              <span className="summary-label">매도가능</span>
              <span className="summary-value max-qty-value">
                보유 {maxSellableQty}주
              </span>
            </div>
          )}
        </div>

        {/* 주문 버튼 */}
        <button
          className={`order-submit-btn ${orderType}`}
          onClick={handleOrder}
          disabled={loading}
        >
          {loading ? '주문 중...' : orderType === 'buy' ? '매수하기' : '매도하기'}
        </button>

        {/* 주의사항 */}
        <div className="order-notice">
          <p>• {priceType === 'market' ? '시장가 주문으로 즉시 체결됩니다' : '지정가 주문으로 설정한 가격에 체결됩니다'}</p>
          <p>• 미국 장 개장 시간: 23:30 ~ 06:00 (한국시간)</p>
          <p className="notice-warning">⚠️ 장 마감 후 표시되는 가격은 전날 종가입니다</p>
          <p className="notice-info">💡 예약 주문 시 시초가 또는 지정가 선택 가능</p>
        </div>
      </div>
    </div>
  )
}

export default OrderPanel

