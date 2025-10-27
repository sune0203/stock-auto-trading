import React, { useState, useEffect } from 'react'
import axios from 'axios'
import './PositionPanel.css'

interface Position {
  ticker: string
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
  const [positions, setPositions] = useState<Position[]>([])
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])
  const [tradingHistory, setTradingHistory] = useState<TradingHistory[]>([])
  const [activeTab, setActiveTab] = useState<'holdings' | 'pending' | 'history'>('holdings') // 보유 | 대기 | 거래내역
  const [isSyncing, setIsSyncing] = useState(false) // 동기화 중 상태

  useEffect(() => {
    loadPositions()
    loadPendingOrders()
    loadTradingHistory()
    const interval = setInterval(() => {
      loadPositions()
      loadPendingOrders()
      if (activeTab === 'history') {
        loadTradingHistory()
      }
    }, 10000) // 10초마다 갱신
    return () => clearInterval(interval)
  }, [activeTab])

  const loadPositions = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/trading/positions')
      console.log('📊 포지션 데이터:', response.data)
      setPositions(response.data || [])
    } catch (error) {
      console.error('포지션 조회 실패:', error)
      setPositions([])
    }
  }

  const loadPendingOrders = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/trading/pending-orders')
      console.log('⏰ 예약 주문 데이터:', response.data)
      setPendingOrders(response.data || [])
    } catch (error) {
      console.error('예약 주문 조회 실패:', error)
      setPendingOrders([])
    }
  }

  const loadTradingHistory = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/trading/history?limit=50')
      console.log('📜 거래내역 데이터:', response.data)
      setTradingHistory(response.data || [])
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
              ${totalValue.toFixed(2)}
              <span className="value-krw">
                {(totalValue * exchangeRate).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원
              </span>
            </span>
          </div>
          <div className="summary-item">
            <span className="summary-label">총 손익</span>
            <span className={`summary-value ${totalProfitLoss >= 0 ? 'profit' : 'loss'}`}>
              {totalProfitLoss >= 0 ? '+' : ''}${totalProfitLoss.toFixed(2)}
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
                  <div className="position-ticker">{position.ticker}</div>
                  <div className="position-quantity">{position.quantity}주</div>
                </div>
                <div className="position-prices">
                  <div className="price-row">
                    <span className="price-label">매수가</span>
                    <span className="price-value">${position.buyPrice.toFixed(2)}</span>
                  </div>
                  <div className="price-row">
                    <span className="price-label">현재가</span>
                    <span className="price-value">${position.currentPrice.toFixed(2)}</span>
                  </div>
                </div>
                <div className={`position-profit ${position.profitLoss >= 0 ? 'profit' : 'loss'}`}>
                  <span className="profit-amount">
                    {position.profitLoss >= 0 ? '+' : ''}${position.profitLoss.toFixed(2)}
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
                      {order.po_limit_price != null && ` ($${Number(order.po_limit_price).toFixed(2)})`}
                    </span>
                  </div>
                  <div className="price-row">
                    <span className="price-label">실행 방식</span>
                    <span className="price-value">
                      {order.po_reservation_type === 'opening' ? '시초가' : '현재가'}
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
                    <span className={`order-type-badge ${history.th_type.toLowerCase()}`}>
                      {history.th_type === 'BUY' ? '매수' : '매도'}
                    </span>
                  </div>
                  <div className="position-quantity">{history.th_quantity}주</div>
                </div>
                <div className="position-prices">
                  <div className="price-row">
                    <span className="price-label">체결가</span>
                    <span className="price-value">${Number(history.th_price).toFixed(2)}</span>
                  </div>
                  <div className="price-row">
                    <span className="price-label">총 금액</span>
                    <span className="price-value">${Number(history.th_amount).toFixed(2)}</span>
                  </div>
                </div>
                {history.th_profit_loss != null && (
                  <div className={`position-profit ${Number(history.th_profit_loss) >= 0 ? 'profit' : 'loss'}`}>
                    <span className="profit-amount">
                      {Number(history.th_profit_loss) >= 0 ? '+' : ''}${Number(history.th_profit_loss).toFixed(2)}
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

