import React, { useEffect, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
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
  const [socket, setSocket] = useState<Socket | null>(null)
  const [useRealTimeData, setUseRealTimeData] = useState(false)

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
    if (!currentPrice || currentPrice === 0) return

    // 가격 틱 단위 계산 (주가에 따라 다른 틱 사이즈)
    const getTickSize = (price: number) => {
      if (price < 1) return 0.01
      if (price < 10) return 0.05
      if (price < 100) return 0.10
      if (price < 500) return 0.25
      return 0.50
    }

    const tickSize = getTickSize(currentPrice)

    // 매도 호가 (현재가 위) - 더 현실적인 데이터
    const newAsks: OrderBookLevel[] = []
    let maxAskQty = 0
    for (let i = 10; i >= 1; i--) {
      const price = currentPrice + (i * tickSize)
      // 현재가에서 멀수록 수량 감소 (더 현실적)
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

    // 매수 호가 (현재가 아래) - 더 현실적인 데이터
    const newBids: OrderBookLevel[] = []
    let maxBidQty = 0
    for (let i = 1; i <= 10; i++) {
      const price = currentPrice - (i * tickSize)
      // 현재가에서 멀수록 수량 증가 (지지선 효과)
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
    setSocket(newSocket)

    newSocket.on('connect', () => {
      // 실시간 호가 구독 요청
      newSocket.emit('subscribe-orderbook', symbol)
    })

    newSocket.on('orderbook-subscribed', (data: { symbol: string; success: boolean }) => {
      if (data.success) {
        setUseRealTimeData(true)
      } else {
        setUseRealTimeData(false)
      }
    })

    newSocket.on('orderbook-update', (data: OrderBookUpdate) => {
      // 실시간 호가 데이터 수신
      
      // 호가 데이터 업데이트
      const newAsks: OrderBookLevel[] = []
      const newBids: OrderBookLevel[] = []
      
      // 매도 호가 (현재가 위)
      for (let i = 10; i >= 1; i--) {
        const price = data.ask.price + (i * 0.05)
        const quantity = Math.floor(data.ask.quantity * (1 + (i / 20)))
        newAsks.push({
          price,
          quantity,
          total: price * quantity,
          percentage: (quantity / data.ask.quantity) * 100
        })
      }
      
      // 매수 호가 (현재가 아래)
      for (let i = 1; i <= 10; i++) {
        const price = data.bid.price - (i * 0.05)
        const quantity = Math.floor(data.bid.quantity * (1 + (i / 15)))
        newBids.push({
          price,
          quantity,
          total: price * quantity,
          percentage: (quantity / data.bid.quantity) * 100
        })
      }
      
      setAsks(newAsks)
      setBids(newBids)
    })

    newSocket.on('disconnect', () => {
      setUseRealTimeData(false)
    })

    return () => {
      // 구독 해제
      newSocket.emit('unsubscribe-orderbook', symbol)
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

  // 초기 호가 데이터 생성 및 짧은 주기로 업데이트 (실시간 데이터가 없을 때만)
  useEffect(() => {
    // 실시간 데이터를 사용 중이면 폴백 데이터 생성 중지
    if (useRealTimeData) {
      return
    }
    
    // 즉시 생성 (폴백)
    generateOrderBook()
    
    // 장이 마감되면 업데이트 중지
    if (!isMarketOpen) {
      return
    }
    
    // 1.5초마다 자동 업데이트 (장 시간에만, 실시간 데이터가 없을 때만)
    const interval = setInterval(() => {
      generateOrderBook()
    }, 1500)

    return () => clearInterval(interval)
  }, [generateOrderBook, isMarketOpen, useRealTimeData])

  const formatPrice = (price: number) => price.toFixed(2)
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
        {/* 매도 호가 (빨간색) */}
        <div className="orderbook-section">
          {[...asks].reverse().map((ask, index) => (
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
          ))}
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
          {bids.map((bid, index) => (
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
          ))}
        </div>
      </div>
    </div>
  )
}

export default OrderBook

