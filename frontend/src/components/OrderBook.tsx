import React, { useEffect, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import './OrderBook.css'

interface OrderBookProps {
  symbol: string
  currentPrice: number
  onPriceClick?: (price: number) => void // 호가 클릭 시 가격 전달
}

interface OrderBookLevel {
  price: number
  quantity: number
  total: number
  percentage: number // 체결강도 (%)
}

interface OrderBookUpdate {
  symbol: string
  timestamp: string
  bid: {
    price: number
    quantity: number
    total: number
  }
  ask: {
    price: number
    quantity: number
    total: number
  }
}

const OrderBook: React.FC<OrderBookProps> = ({ symbol, currentPrice, onPriceClick }) => {
  const [asks, setAsks] = useState<OrderBookLevel[]>([])
  const [bids, setBids] = useState<OrderBookLevel[]>([])
  const [isMarketOpen, setIsMarketOpen] = useState(true)
  const [useRealTimeData, setUseRealTimeData] = useState(false)
  const [lastDataReceived, setLastDataReceived] = useState<number>(Date.now())

  // 미국 장 시간 체크 함수
  const checkMarketOpen = useCallback(() => {
    const now = new Date()
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = estTime.getDay()
    const hours = estTime.getHours()
    const minutes = estTime.getMinutes()
    
    // 주말 체크
    if (day === 0 || day === 6) return false
    
    // 정규 장 시간: 09:30 ~ 16:00 EST
    const currentMinutes = hours * 60 + minutes
    const marketOpen = 9 * 60 + 30  // 09:30
    const marketClose = 16 * 60     // 16:00
    
    return currentMinutes >= marketOpen && currentMinutes < marketClose
  }, [])

  // 호가 데이터 생성 함수 (항상 최신 currentPrice 사용)
  const generateOrderBook = useCallback(() => {
    if (!currentPrice || currentPrice === 0) {
      console.log(`⚠️ [OrderBook] 호가 생성 불가: currentPrice = ${currentPrice}`)
      return
    }

    // 🔥 US 주식 틱 사이즈 (실제 규정에 따름)
    const getTickSize = (price: number) => {
      if (price < 1) return 0.0001  // $1 미만: $0.0001 단위
      return 0.01                    // $1 이상: $0.01 단위
    }

    const tickSize = getTickSize(currentPrice)

    // 🔥 매도 호가 (현재가보다 높은 가격) - 폴백 데이터 5개만
    const newAsks: OrderBookLevel[] = []
    let maxAskQty = 0
    for (let i = 1; i <= 5; i++) {
      const price = currentPrice + (i * tickSize)
      const baseQty = Math.floor(Math.random() * 500) + 100
      const quantity = Math.floor(baseQty * (1 + (i / 20)))
      const total = price * quantity
      maxAskQty = Math.max(maxAskQty, quantity)
      newAsks.push({ price, quantity, total, percentage: 0 })
    }
    // 체결강도 계산
    newAsks.forEach(ask => {
      ask.percentage = (ask.quantity / maxAskQty) * 100
    })

    // 🔥 매수 호가 (현재가보다 낮은 가격) - 폴백 데이터 5개만
    const newBids: OrderBookLevel[] = []
    let maxBidQty = 0
    for (let i = 1; i <= 5; i++) {
      const price = currentPrice - (i * tickSize)
      const baseQty = Math.floor(Math.random() * 500) + 100
      const quantity = Math.floor(baseQty * (1 + (i / 15)))
      const total = price * quantity
      maxBidQty = Math.max(maxBidQty, quantity)
      newBids.push({ price, quantity, total, percentage: 0 })
    }
    // 체결강도 계산
    newBids.forEach(bid => {
      bid.percentage = (bid.quantity / maxBidQty) * 100
    })

    setAsks(newAsks)
    setBids(newBids)
  }, [currentPrice]) // currentPrice가 변경되면 함수도 재생성

  // Socket.IO 연결 및 실시간 호가 구독
  useEffect(() => {
    // Socket.IO 연결
    const newSocket = io('http://localhost:3001')

    newSocket.on('connect', () => {
      // 실시간 호가 구독 요청
      console.log(`📡 [OrderBook] Socket 연결 성공, 호가 구독: ${symbol}`)
      newSocket.emit('subscribe-orderbook', symbol)
    })

    newSocket.on('orderbook-subscribed', (data: { symbol: string; success: boolean }) => {
      console.log(`✅ [OrderBook] 호가 구독 ${data.success ? '성공' : '실패'}: ${symbol}`)
      if (data.success) {
        setUseRealTimeData(true)
      } else {
        setUseRealTimeData(false)
      }
    })

    newSocket.on('orderbook-update', (data: OrderBookUpdate) => {
      // 🔥 현재 종목이 아닌 호가 데이터는 무시
      if (data.symbol !== symbol) {
        console.log(`⚠️ [OrderBook] 다른 종목 호가 무시: ${data.symbol} (현재: ${symbol})`)
        return
      }
      
      // 🔥 실시간 호가 수신 시간 업데이트
      setLastDataReceived(Date.now())
      
      // 실시간 호가 데이터 수신
      console.log(`📊 [OrderBook] 실시간 호가 수신: ${symbol}`, {
        bid: `$${data.bid.price} x ${data.bid.quantity}`,
        ask: `$${data.ask.price} x ${data.ask.quantity}`
      })
      
      // 🔥 KIS는 1호가만 제공 (매수 < 현재가 < 매도)
      const newAsks: OrderBookLevel[] = [{
        price: data.ask.price,
        quantity: data.ask.quantity,
        total: data.ask.price * data.ask.quantity,
        percentage: 100
      }]
      
      const newBids: OrderBookLevel[] = [{
        price: data.bid.price,
        quantity: data.bid.quantity,
        total: data.bid.price * data.bid.quantity,
        percentage: 100
      }]
      
      console.log(`✅ [OrderBook] ${symbol} 실제 KIS 호가:`)
      console.log(`   매도 1호가: $${data.ask.price} (${data.ask.quantity}주) ← 매도가능`)
      console.log(`   매수 1호가: $${data.bid.price} (${data.bid.quantity}주) ← 매수가능`)
      console.log(`   스프레드: $${(data.ask.price - data.bid.price).toFixed(4)}`)
      
      setAsks(newAsks)
      setBids(newBids)
    })

    newSocket.on('disconnect', () => {
      setUseRealTimeData(false)
    })

    return () => {
      // 🔥 구독 해제 (연결된 경우만)
      if (newSocket.connected) {
        console.log(`🔻 호가 구독 해제: ${symbol}`)
        newSocket.emit('unsubscribe-orderbook', symbol)
      }
      newSocket.disconnect()
    }
  }, [symbol])

  // 장 시간 체크 및 상태 업데이트
  useEffect(() => {
    const updateMarketStatus = () => {
      const marketOpen = checkMarketOpen()
      setIsMarketOpen(marketOpen)
    }
    
    // 초기 체크
    updateMarketStatus()
    
    // 1분마다 장 시간 체크
    const statusInterval = setInterval(updateMarketStatus, 60000)
    
    return () => clearInterval(statusInterval)
  }, [checkMarketOpen])

  // 🔥 실시간 데이터 타임아웃 체크 (5초 동안 데이터 없으면 폴백으로 전환)
  useEffect(() => {
    if (!useRealTimeData) return
    
    const checkTimeout = setInterval(() => {
      const timeSinceLastData = Date.now() - lastDataReceived
      if (timeSinceLastData > 5000) { // 5초 초과
        console.log(`⏱️ [OrderBook] 실시간 호가 타임아웃 (${timeSinceLastData}ms), 폴백으로 전환`)
        setUseRealTimeData(false)
      }
    }, 1000)
    
    return () => clearInterval(checkTimeout)
  }, [useRealTimeData, lastDataReceived])
  
  // 초기 호가 데이터 생성 및 짧은 주기로 업데이트
  useEffect(() => {
    // 🔥 가격이 없으면 대기
    if (!currentPrice || currentPrice === 0) {
      console.log(`⏳ [OrderBook] 가격 로딩 대기 중...`)
      return
    }
    
    // 🔥 실시간 데이터를 사용 중이면 폴백 생성 중지
    if (useRealTimeData) {
      console.log(`✋ [OrderBook] 실시간 호가 사용 중, 폴백 생성 중지`)
      return
    }
    
    // 실시간 데이터가 없으면 폴백 데이터 생성
    console.log(`🔄 [OrderBook] 폴백 호가 생성 시작 (currentPrice: $${currentPrice})`)
    generateOrderBook()
    
    // 1.5초마다 자동 업데이트 (실시간 데이터 없을 때만)
    const interval = setInterval(() => {
      generateOrderBook()
    }, 1500)

    return () => clearInterval(interval)
  }, [currentPrice, generateOrderBook, useRealTimeData])

  const formatPrice = (price: number) => {
    // $10 미만: 소수점 4자리, $10 이상: 소수점 2자리
    if (price < 10) {
      return price.toFixed(4)
    } else {
      return price.toFixed(2)
    }
  }
  const formatQuantity = (qty: number) => qty.toLocaleString()

  return (
    <div className="orderbook">
      <div className="orderbook-header">
        <h3 className="orderbook-title">호가</h3>
        <div className={`realtime-badge ${!isMarketOpen ? 'market-closed' : ''} ${useRealTimeData ? 'kis-realtime' : ''}`}>
          {!isMarketOpen ? '⏸️ 장 마감' : useRealTimeData ? '🔴 KIS 실시간' : '🔄 1.5초 자동갱신'}
        </div>
      </div>

      <div className="orderbook-table-header">
        <div className="header-col">매도잔량</div>
        <div className="header-col">가격</div>
        <div className="header-col">매수잔량</div>
      </div>

      <div className="orderbook-content">
        {/* 매도 호가 (빨간색) - 높은 가격부터 아래로 */}
        <div className="orderbook-section">
          {asks.length === 0 ? (
            <div style={{ 
              padding: '20px', 
              textAlign: 'center', 
              color: '#999',
              fontSize: '14px'
            }}>
              호가 로딩 중...
            </div>
          ) : (
            [...asks].reverse().map((ask, index) => (
              <div 
                key={`ask-${index}`} 
                className="orderbook-row clickable"
                onClick={() => onPriceClick && onPriceClick(ask.price)}
              >
                <div className="qty-cell left">
                  <span className="qty-text ask-qty">{formatQuantity(ask.quantity)}</span>
                  <div 
                    className="qty-bar ask-bar" 
                    style={{ width: `${ask.percentage}%` }}
                  />
                </div>
                <div className="price-cell">
                  <span className="price ask-price">${formatPrice(ask.price)}</span>
                </div>
                <div className="qty-cell right empty"></div>
              </div>
            ))
          )}
        </div>

        {/* 현재가 - 클릭 가능, key 추가로 강제 리렌더링 */}
        <div 
          key={`current-${currentPrice}`}
          className="orderbook-current clickable"
          onClick={() => onPriceClick && onPriceClick(currentPrice)}
        >
          <span className="current-label">현재가</span>
          <span className="current-price">${formatPrice(currentPrice)}</span>
        </div>

        {/* 매수 호가 (파란색) */}
        <div className="orderbook-section">
          {bids.length === 0 ? (
            <div style={{ 
              padding: '20px', 
              textAlign: 'center', 
              color: '#999',
              fontSize: '14px'
            }}>
              호가 로딩 중...
            </div>
          ) : (
            bids.map((bid, index) => (
              <div 
                key={`bid-${index}`} 
                className="orderbook-row clickable"
                onClick={() => onPriceClick && onPriceClick(bid.price)}
              >
                <div className="qty-cell left empty"></div>
                <div className="price-cell">
                  <span className="price bid-price">${formatPrice(bid.price)}</span>
                </div>
                <div className="qty-cell right">
                  <div 
                    className="qty-bar bid-bar" 
                    style={{ width: `${bid.percentage}%` }}
                  />
                  <span className="qty-text bid-qty">{formatQuantity(bid.quantity)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default OrderBook

