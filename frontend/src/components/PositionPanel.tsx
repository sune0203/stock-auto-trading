import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { io, Socket } from 'socket.io-client'
import './PositionPanel.css'

interface Position {
  ticker: string
  stockNameKo?: string // 한국어 종목명 추가
  quantity: number
  buyPrice: number
  currentPrice: number
  profitLoss: number
  profitLossPercent: number
  buyTime?: string
}

interface PendingOrder {
  po_id: number
  po_ticker: string
  stockNameKo?: string // 한국어 종목명 추가
  po_order_type: 'buy' | 'sell'
  po_quantity: number
  po_price_type: 'market' | 'limit'
  po_limit_price?: number
  po_reservation_type: 'opening' | 'current'
  po_status: 'pending' | 'executed' | 'cancelled' | 'failed'
  po_created_at: string
  po_reason?: string
}

interface TradingHistory {
  th_id: number
  th_ticker: string
  stockNameKo?: string // 한국어 종목명 추가
  th_type: 'BUY' | 'SELL'
  th_price: number
  th_quantity: number
  th_amount: number
  th_profit_loss?: number
  th_profit_loss_percent?: number
  th_reason?: string
  th_timestamp: string
}

interface PositionPanelProps {
  exchangeRate: number
  onBuyClick?: (ticker: string) => void // 추가 구매 클릭
  onSellClick?: (ticker: string) => void // 판매 클릭
}

const PositionPanel: React.FC<PositionPanelProps> = ({ exchangeRate, onBuyClick, onSellClick }) => {
  // 가격 포맷 함수
  const formatPrice = (price: number) => {
    if (price >= 1) {
      return price.toFixed(2)
    } else {
      return price.toFixed(4)
    }
  }
  const [positions, setPositions] = useState<Position[]>([])
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])
  const [tradingHistory, setTradingHistory] = useState<TradingHistory[]>([])
  const [activeTab, setActiveTab] = useState<'holdings' | 'pending' | 'history'>('holdings') // 보유 | 대기 | 거래내역
  const [stockNames, setStockNames] = useState<Map<string, string>>(new Map()) // 티커 → 한국어 이름 맵
  const [isSyncing, setIsSyncing] = useState(false) // 동기화 중 상태
  const [socket, setSocket] = useState<Socket | null>(null) // WebSocket 연결

  // WebSocket 연결 및 실시간 가격 구독
  useEffect(() => {
    const newSocket = io('http://localhost:3001')
    setSocket(newSocket)

    return () => {
      newSocket.close()
    }
  }, [])

  // 현재 구독 중인 티커 목록을 ref로 관리 (재렌더링 방지)
  const subscribedTickers = React.useRef<Set<string>>(new Set())

  // 보유 종목 실시간 가격 구독 (티커 변경 시에만)
  useEffect(() => {
    if (!socket || positions.length === 0) return

    const currentTickers = new Set(positions.map(p => p.ticker))
    const previousTickers = subscribedTickers.current

    // 새로 추가된 티커 구독
    const tickersToAdd = Array.from(currentTickers).filter(t => !previousTickers.has(t))
    if (tickersToAdd.length > 0) {
      console.log(`🔄 [PositionPanel] 새 티커 구독: ${tickersToAdd.join(', ')}`)
      tickersToAdd.forEach(ticker => {
        socket.emit('subscribe:realtime', [ticker])
      })
    }

    // 제거된 티커 구독 해제
    const tickersToRemove = Array.from(previousTickers).filter(t => !currentTickers.has(t))
    if (tickersToRemove.length > 0) {
      console.log(`❌ [PositionPanel] 티커 구독 해제: ${tickersToRemove.join(', ')}`)
      tickersToRemove.forEach(ticker => {
        socket.emit('unsubscribe:realtime', [ticker])
      })
    }

    // 구독 목록 업데이트
    subscribedTickers.current = currentTickers

    return () => {
      // 컴포넌트 언마운트 시 모든 구독 해제
      Array.from(subscribedTickers.current).forEach(ticker => {
        socket.emit('unsubscribe:realtime', [ticker])
      })
      subscribedTickers.current.clear()
    }
  }, [socket, positions.map(p => p.ticker).sort().join(',')])

  // 실시간 가격 업데이트 리스너
  useEffect(() => {
    if (!socket) return

    const handlePriceUpdate = (data: any) => {
      if (data && data.symbol && data.price) {
        const currentPrice = data.price
        console.log(`💵 [PositionPanel] ${data.symbol} 실시간 가격: $${currentPrice}`)
        
        // 포지션의 현재가 업데이트
        setPositions(prev => {
          let updated = false
          const newPositions = prev.map(pos => {
            if (pos.ticker === data.symbol) {
              updated = true
              const profitLoss = (currentPrice - pos.buyPrice) * pos.quantity
              const profitLossPercent = ((currentPrice - pos.buyPrice) / pos.buyPrice) * 100
              
              console.log(`📊 [PositionPanel] ${data.symbol} 포지션 업데이트:`, {
                이전_현재가: pos.currentPrice,
                새_현재가: currentPrice,
                매수가: pos.buyPrice,
                수량: pos.quantity,
                손익: profitLoss.toFixed(4),
                손익률: profitLossPercent.toFixed(2) + '%'
              })
              
              return {
                ...pos,
                currentPrice,
                profitLoss,
                profitLossPercent
              }
            }
            return pos
          })
          
          if (!updated) {
            console.warn(`⚠️ [PositionPanel] ${data.symbol} 포지션을 찾을 수 없음`)
          }
          
          return newPositions
        })
      }
    }

    socket.on('realtime:price', handlePriceUpdate)
    console.log('✅ [PositionPanel] realtime:price 리스너 등록')

    return () => {
      socket.off('realtime:price', handlePriceUpdate)
      console.log('❌ [PositionPanel] realtime:price 리스너 해제')
    }
  }, [socket])

  // 배치 API로 모든 포지션 가격 업데이트 (애프터마켓 우선)
  const updatePositionPricesBatch = async () => {
    if (positions.length === 0) return

    try {
      const tickers = positions.map(p => p.ticker).join(',')
      
      // 1. 애프터마켓 배치 API 우선 시도
      const aftermarketResponse = await fetch(`https://financialmodelingprep.com/stable/batch-aftermarket-trade?symbols=${tickers}&apikey=Nz122fIiH3KWDx8UVBdQFL8a5NU9lRhc`)
      const aftermarketTrades = await aftermarketResponse.json()
      
      // 애프터마켓 가격을 Map으로 변환
      const priceMap = new Map<string, number>()
      
      if (Array.isArray(aftermarketTrades) && aftermarketTrades.length > 0) {
        aftermarketTrades.forEach((trade: any) => {
          if (trade.symbol && trade.price && trade.price > 0) {
            priceMap.set(trade.symbol, trade.price)
          }
        })
        console.log(`🌙 [FMP Batch Aftermarket] ${aftermarketTrades.map((t: any) => `${t.symbol}=$${t.price}`).join(', ')}`)
      }
      
      // 2. 애프터마켓에 없는 종목은 정규장 Quote API로 조회
      const missingTickers = positions
        .map(p => p.ticker)
        .filter(ticker => !priceMap.has(ticker))
      
      if (missingTickers.length > 0) {
        const quoteResponse = await fetch(`https://financialmodelingprep.com/api/v3/quote/${missingTickers.join(',')}?apikey=Nz122fIiH3KWDx8UVBdQFL8a5NU9lRhc`)
        const quotes = await quoteResponse.json()
        
        if (Array.isArray(quotes) && quotes.length > 0) {
          quotes.forEach((quote: any) => {
            if (quote.symbol && quote.price && quote.price > 0) {
              priceMap.set(quote.symbol, quote.price)
            }
          })
          console.log(`💵 [FMP Batch Quote] ${quotes.map((q: any) => `${q.symbol}=$${q.price}`).join(', ')}`)
        }
      }
      
      // 3. 가격 업데이트
      setPositions(prev => 
        prev.map(pos => {
          const currentPrice = priceMap.get(pos.ticker)
          if (currentPrice && currentPrice > 0) {
            const profitLoss = (currentPrice - pos.buyPrice) * pos.quantity
            const profitLossPercent = ((currentPrice - pos.buyPrice) / pos.buyPrice) * 100
            
            return {
              ...pos,
              currentPrice,
              profitLoss,
              profitLossPercent
            }
          }
          return pos
        })
      )
    } catch (error) {
      console.error('❌ [PositionPanel] 배치 가격 업데이트 실패:', error)
    }
  }

  useEffect(() => {
    loadPositions()
    loadPendingOrders()
    loadTradingHistory()
    
    const interval = setInterval(() => {
      loadPendingOrders()
      if (activeTab === 'history') {
        loadTradingHistory()
      }
    }, 10000) // 10초마다 대기/거래내역 갱신
    
    return () => {
      clearInterval(interval)
    }
  }, [activeTab])

  // 배치 가격 업데이트 (포지션이 있을 때만)
  useEffect(() => {
    if (positions.length === 0) return

    // 초기 배치 업데이트
    const initialTimer = setTimeout(() => {
      updatePositionPricesBatch()
    }, 3000)

    // 2초마다 배치 업데이트
    const batchInterval = setInterval(() => {
      updatePositionPricesBatch()
    }, 2000)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(batchInterval)
    }
  }, [positions.map(p => p.ticker).sort().join(',')])

  // 종목 한국어 이름 조회
  const fetchStockName = async (ticker: string): Promise<string> => {
    if (stockNames.has(ticker)) {
      return stockNames.get(ticker)!
    }
    
    try {
      const response = await axios.get(`http://localhost:3001/api/stocks/${ticker}`)
      const nameKo = response.data?.s_name_kr || ''
      setStockNames(prev => new Map(prev).set(ticker, nameKo))
      return nameKo
    } catch (error) {
      return ''
    }
  }

  const loadPositions = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/trading/positions')
      console.log('📊 [PositionPanel] 포지션 데이터:', response.data)
      
      // 한국어 이름 추가 및 실시간 가격 업데이트
      const positionsWithNames = await Promise.all(
        (response.data || []).map(async (pos: Position) => {
          const stockNameKo = await fetchStockName(pos.ticker)
          
          // 실시간 가격 조회
          try {
            const priceResponse = await fetch(`http://localhost:3001/api/realtime/quote/${pos.ticker}`)
            const priceData = await priceResponse.json()
            
            if (priceData && priceData.price) {
              const currentPrice = priceData.price
              const profitLoss = (currentPrice - pos.buyPrice) * pos.quantity
              const profitLossPercent = ((currentPrice - pos.buyPrice) / pos.buyPrice) * 100
              
              console.log(`💵 [PositionPanel] ${pos.ticker} 초기 가격: $${currentPrice} (매수가: $${pos.buyPrice})`)
              
              return {
                ...pos,
                stockNameKo,
                currentPrice,
                profitLoss,
                profitLossPercent
              }
            }
          } catch (err) {
            console.warn(`⚠️ [PositionPanel] ${pos.ticker} 가격 조회 실패:`, err)
          }
          
          return {
            ...pos,
            stockNameKo
          }
        })
      )
      
      setPositions(positionsWithNames)
    } catch (error) {
      console.error('포지션 조회 실패:', error)
      setPositions([])
    }
  }

  const loadPendingOrders = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/trading/pending-orders')
      console.log('⏰ 예약 주문 데이터:', response.data)
      
      // 한국어 이름 추가
      const ordersWithNames = await Promise.all(
        (response.data || []).map(async (order: PendingOrder) => ({
          ...order,
          stockNameKo: await fetchStockName(order.po_ticker)
        }))
      )
      
      setPendingOrders(ordersWithNames)
    } catch (error) {
      console.error('예약 주문 조회 실패:', error)
      setPendingOrders([])
    }
  }

  const loadTradingHistory = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/trading/history?limit=50')
      console.log('📜 거래내역 데이터:', response.data)
      
      // 한국어 이름 추가
      const historyWithNames = await Promise.all(
        (response.data || []).map(async (history: TradingHistory) => ({
          ...history,
          stockNameKo: await fetchStockName(history.th_ticker)
        }))
      )
      
      setTradingHistory(historyWithNames)
    } catch (error) {
      console.error('거래내역 조회 실패:', error)
      setTradingHistory([])
    }
  }

  // KIS 데이터 수동 동기화
  const handleManualSync = async () => {
    setIsSyncing(true)
    try {
      console.log('🔄 수동 동기화 시작...')
      const response = await axios.post('http://localhost:3001/api/trading/sync')
      console.log('✅ 동기화 완료:', response.data)
      
      // 모든 데이터 새로고침
      await Promise.all([
        loadPositions(),
        loadPendingOrders(),
        loadTradingHistory()
      ])
      
      alert('KIS 데이터 동기화 완료!')
    } catch (error) {
      console.error('❌ 동기화 실패:', error)
      alert('동기화 실패: ' + (error as any).message)
    } finally {
      setIsSyncing(false)
    }
  }

  // 예약 주문 취소
  const handleCancelPendingOrder = async (orderId: number) => {
    if (!confirm('이 예약 주문을 취소하시겠습니까?')) {
      return
    }

    try {
      console.log(`❌ 예약 주문 취소 시도: ID ${orderId}`)
      const response = await axios.delete(`http://localhost:3001/api/trading/pending-orders/${orderId}`)
      console.log('✅ 취소 완료:', response.data)
      
      alert(response.data.message)
      
      // 예약 주문 목록 새로고침
      await loadPendingOrders()
    } catch (error: any) {
      console.error('❌ 예약 주문 취소 실패:', error)
      alert(error.response?.data?.error || '예약 주문 취소에 실패했습니다.')
    }
  }

  const totalInvestment = positions.reduce((sum, pos) => sum + (pos.buyPrice * pos.quantity), 0)
  const totalValue = positions.reduce((sum, pos) => sum + (pos.currentPrice * pos.quantity), 0)
  const totalProfitLoss = totalValue - totalInvestment
  const totalProfitLossPercent = totalInvestment > 0 ? (totalProfitLoss / totalInvestment) * 100 : 0

  return (
    <div className="position-panel">
      <div className="position-header">
        <h3>보유 포지션</h3>
        <div className="header-buttons">
          <button 
            className="sync-btn" 
            onClick={handleManualSync}
            disabled={isSyncing}
          >
            {isSyncing ? '🔄 동기화 중...' : '🔄 KIS 동기화'}
          </button>
          <button className="refresh-btn" onClick={loadPositions}>
            새로고침
          </button>
        </div>
      </div>

      {/* 탭: 보유 | 대기 | 거래내역 */}
      <div className="position-tabs">
        <button
          className={`position-tab ${activeTab === 'holdings' ? 'active' : ''}`}
          onClick={() => setActiveTab('holdings')}
        >
          보유
        </button>
        <button
          className={`position-tab ${activeTab === 'pending' ? 'active' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          대기
        </button>
        <button
          className={`position-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          거래내역
        </button>
      </div>

      {/* 총 수익률 */}
      {positions.length > 0 && (
        <div className="position-summary">
          <div className="summary-item">
            <span className="summary-label">총 평가액</span>
            <span className="summary-value">
              ${formatPrice(totalValue)}
              <span className="value-krw">
                {(totalValue * exchangeRate).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원
              </span>
            </span>
          </div>
          <div className="summary-item">
            <span className="summary-label">총 손익</span>
            <span className={`summary-value ${totalProfitLoss >= 0 ? 'profit' : 'loss'}`}>
              {totalProfitLoss >= 0 ? '+' : ''}${formatPrice(Math.abs(totalProfitLoss))}
              <span className="profit-percent">
                ({totalProfitLossPercent >= 0 ? '+' : ''}{totalProfitLossPercent.toFixed(2)}%)
              </span>
            </span>
          </div>
        </div>
      )}

      {/* 포지션 리스트 */}
      <div className="position-list">
        {activeTab === 'holdings' ? (
          // 보유 탭
          positions.length === 0 ? (
            <div className="empty-positions">
              <p>보유 중인 포지션이 없습니다</p>
            </div>
          ) : (
            positions.map((position) => (
              <div key={position.ticker} className="position-item">
                <div className="position-info">
                  <div className="position-ticker">
                    {position.ticker}
                    {position.stockNameKo && <span className="ticker-name-ko">{position.stockNameKo}</span>}
                  </div>
                  <div className="position-quantity">{position.quantity}주</div>
                </div>
                <div className="position-prices">
                  <div className="price-row">
                    <span className="price-label">매수가</span>
                    <span className="price-value">${formatPrice(position.buyPrice)}</span>
                  </div>
                  <div className="price-row">
                    <span className="price-label">현재가</span>
                    <span className="price-value">${formatPrice(position.currentPrice)}</span>
                  </div>
                </div>
                <div className={`position-profit ${position.profitLoss >= 0 ? 'profit' : 'loss'}`}>
                  <span className="profit-amount">
                    {position.profitLoss >= 0 ? '+' : ''}${formatPrice(Math.abs(position.profitLoss))}
                  </span>
                  <span className="profit-percent">
                    ({position.profitLossPercent >= 0 ? '+' : ''}{position.profitLossPercent.toFixed(2)}%)
                  </span>
                </div>
                {/* 추가 구매/판매 버튼 */}
                <div className="position-actions">
                  <button
                    className="position-action-btn buy"
                    onClick={() => onBuyClick && onBuyClick(position.ticker)}
                  >
                    추가 구매
                  </button>
                  <button
                    className="position-action-btn sell"
                    onClick={() => onSellClick && onSellClick(position.ticker)}
                  >
                    판매
                  </button>
                </div>
              </div>
            ))
          )
        ) : activeTab === 'pending' ? (
          // 대기 탭
          pendingOrders.length === 0 ? (
            <div className="empty-positions">
              <p>대기 중인 주문이 없습니다</p>
              <span className="empty-desc">장 마감 시 예약 주문이 여기에 표시됩니다</span>
            </div>
          ) : (
            pendingOrders.map((order) => (
              <div key={order.po_id} className="position-item pending-order">
                <div className="position-info">
                  <div className="position-ticker">
                    {order.po_ticker}
                    {order.stockNameKo && <span className="ticker-name-ko">{order.stockNameKo}</span>}
                    <span className={`order-type-badge ${order.po_order_type}`}>
                      {order.po_order_type === 'buy' ? '매수' : '매도'}
                    </span>
                  </div>
                  <div className="position-quantity">{order.po_quantity}주</div>
                </div>
                <div className="position-prices">
                  <div className="price-row">
                    <span className="price-label">주문 타입</span>
                    <span className="price-value">
                      {order.po_price_type === 'market' ? '시장가' : '지정가'}
                    </span>
                  </div>
                  <div className="price-row">
                    <span className="price-label">실행 방식</span>
                    <span className="price-value execution-type">
                      {order.po_price_type === 'market' ? (
                        <span className="market-order">
                          시초가 (장 시작 시 시장가 체결)
                        </span>
                      ) : (
                        <span className="limit-order">
                          지정가 ${order.po_limit_price != null ? formatPrice(Number(order.po_limit_price)) : '0.0000'}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="pending-order-info">
                  <div className="order-status pending">
                    ⏰ 대기 중
                  </div>
                  <div className="order-time">
                    {new Date(order.po_created_at).toLocaleString('ko-KR', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                  <button
                    className="cancel-order-btn"
                    onClick={() => handleCancelPendingOrder(order.po_id)}
                    title="예약 주문 취소"
                  >
                    취소
                  </button>
                </div>
              </div>
            ))
          )
        ) : (
          // 거래내역 탭
          tradingHistory.length === 0 ? (
            <div className="empty-positions">
              <p>거래 내역이 없습니다</p>
            </div>
          ) : (
            tradingHistory.map((history) => (
              <div key={history.th_id} className="position-item trading-history">
                <div className="position-info">
                  <div className="position-ticker">
                    {history.th_ticker}
                    {history.stockNameKo && <span className="ticker-name-ko">{history.stockNameKo}</span>}
                    <span className={`order-type-badge ${history.th_type.toLowerCase()}`}>
                      {history.th_type === 'BUY' ? '매수' : '매도'}
                    </span>
                  </div>
                  <div className="position-quantity">{history.th_quantity}주</div>
                </div>
                <div className="position-prices">
                  <div className="price-row">
                    <span className="price-label">체결가</span>
                    <span className="price-value">${formatPrice(Number(history.th_price))}</span>
                  </div>
                  <div className="price-row">
                    <span className="price-label">총 금액</span>
                    <span className="price-value">${formatPrice(Number(history.th_amount))}</span>
                  </div>
                </div>
                {history.th_profit_loss != null && (
                  <div className={`position-profit ${Number(history.th_profit_loss) >= 0 ? 'profit' : 'loss'}`}>
                    <span className="profit-amount">
                      {Number(history.th_profit_loss) >= 0 ? '+' : ''}${formatPrice(Math.abs(Number(history.th_profit_loss)))}
                    </span>
                    {history.th_profit_loss_percent != null && (
                      <span className="profit-percent">
                        ({Number(history.th_profit_loss_percent) >= 0 ? '+' : ''}{Number(history.th_profit_loss_percent).toFixed(2)}%)
                      </span>
                    )}
                  </div>
                )}
                <div className="history-time">
                  {new Date(history.th_timestamp).toLocaleString('ko-KR', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              </div>
            ))
          )
        )}
      </div>
    </div>
  )
}

export default PositionPanel

