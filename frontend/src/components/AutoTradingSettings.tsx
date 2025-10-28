import React, { useState, useEffect } from 'react'
import axios from 'axios'
import './AutoTradingSettings.css'

interface AutoTradingConfig {
  enabled: boolean
  bullish_threshold: number // 호재 점수 임계값 (%)
  impact_threshold: number // 당일 상승 점수 임계값 (%)
  investment_percent: number // 잔고 대비 투자 비율 (%)
  max_investment: number // 최대 투자 금액 ($)
  take_profit_percent: number // 익절 비율 (%)
  stop_loss_percent: number // 손절 비율 (%)
}

interface DetectedNews {
  n_idx: number
  n_ticker: string
  n_symbol: string
  primaryTicker: string // 우선 티커 (n_ticker 또는 n_symbol)
  alternateTicker: string | null // 대체 티커 (둘 다 있고 다를 경우)
  n_title: string
  n_title_kr: string
  n_bullish: number
  n_immediate_impact: number
  n_in_time: string
  currentPrice?: number
  stockNameKo?: string
  capturedPriceUSD?: number | null // 뉴스 캡처 당시 가격 (USD)
  capturedVolume?: number | null // 뉴스 캡처 당시 거래량
  changePercent?: number
  change?: number
}

interface AutoTradingSettingsProps {
  onClose: () => void
}

const AutoTradingSettings: React.FC<AutoTradingSettingsProps> = ({ onClose }) => {
  const [config, setConfig] = useState<AutoTradingConfig>({
    enabled: false,
    bullish_threshold: 95,
    impact_threshold: 95,
    investment_percent: 10,
    max_investment: 1000,
    take_profit_percent: 10,
    stop_loss_percent: 5
  })

  const [detectedNews, setDetectedNews] = useState<DetectedNews[]>([])
  const [processedNewsIds, setProcessedNewsIds] = useState<Set<number>>(new Set()) // 이미 처리된 뉴스 ID
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [position, setPosition] = useState({ x: window.innerWidth / 2 - 400, y: 50 })
  const [currentBalance, setCurrentBalance] = useState<number>(0) // 현재 잔고

  // 초기 설정 로드 (팝업 열릴 때 한 번만 실행)
  useEffect(() => {
    loadConfig()
    loadBalance()
    loadInitialNews() // 초기 뉴스 5개 로드

    // 30초마다 새 뉴스 체크 (백그라운드에서 조용히 업데이트)
    const newsCheckInterval = setInterval(() => {
      checkNewNews()
    }, 30000) // 30초

    return () => clearInterval(newsCheckInterval)
  }, [])

  // 잔고 조회
  const loadBalance = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/trading/balance')
      if (response.data.success) {
        setCurrentBalance(response.data.buyingPower || 0)
      }
    } catch (error) {
      console.error('잔고 조회 실패:', error)
    }
  }

  // 설정 로드
  const loadConfig = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/auto-trading/config')
      if (response.data) {
        setConfig(response.data)
      }
    } catch (error) {
      console.error('자동매수 설정 로드 실패:', error)
    }
  }

  // 초기 뉴스 5개 로드 (팝업 열릴 때 한 번만)
  const loadInitialNews = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/auto-trading/detected-news')
      if (response.data && response.data.length > 0) {
        const initialNews = response.data.slice(0, 5)
        setDetectedNews(initialNews)
        
        // 처리된 뉴스 ID 저장
        const ids = new Set(initialNews.map((news: DetectedNews) => news.n_idx))
        setProcessedNewsIds(ids)
      } else {
        setDetectedNews([])
        setProcessedNewsIds(new Set())
      }
    } catch (error) {
      console.error('초기 뉴스 로드 실패:', error)
    }
  }

  // 새 뉴스 체크 및 업데이트 (백그라운드에서 주기적으로 실행)
  const checkNewNews = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/auto-trading/detected-news')
      if (response.data && response.data.length > 0) {
        const allNews = response.data
        
        // 새로운 뉴스만 필터링 (processedNewsIds에 없는 것)
        const newNews = allNews.filter((news: DetectedNews) => !processedNewsIds.has(news.n_idx))
        
        if (newNews.length > 0) {
          // 새 뉴스를 앞에 추가하고, 5개만 유지 (FIFO)
          setDetectedNews(prev => {
            const updated = [...newNews, ...prev].slice(0, 5)
            
            // 처리된 뉴스 ID 업데이트
            const ids = new Set(updated.map((news: DetectedNews) => news.n_idx))
            setProcessedNewsIds(ids)
            
            return updated
          })
        }
      }
    } catch (error) {
      console.error('새 뉴스 체크 실패:', error)
    }
  }

  // 설정 저장
  const saveConfig = async () => {
    try {
      await axios.post('http://localhost:3001/api/auto-trading/config', config)
      alert('설정이 저장되었습니다.')
    } catch (error) {
      console.error('설정 저장 실패:', error)
      alert('설정 저장에 실패했습니다.')
    }
  }

  // 즉시 매수 실행
  const handleBuyNow = (news: DetectedNews, selectedTicker?: string) => {
    // 사용할 티커 결정 (사용자가 선택했으면 그것, 아니면 primaryTicker)
    const ticker = selectedTicker || news.primaryTicker
    
    // 팝업 닫기
    onClose()
    
    // 해당 티커로 페이지 전환 및 매수 설정
    // URL 해시로 티커와 주문 정보 전달
    window.location.hash = `/trading?symbol=${ticker}&orderType=buy&priceType=market`
  }

  // 드래그 시작
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.settings-header')) {
      setIsDragging(true)
      setDragOffset({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      })
    }
  }

  // 드래그 중
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y
        })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragOffset])

  return (
    <div className="auto-trading-overlay" onClick={onClose}>
      <div
        className="auto-trading-settings"
        style={{ left: `${position.x}px`, top: `${position.y}px` }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
      >
        <div className="settings-header">
          <h3>🤖 자동 매수 설정</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          {/* 기본 설정 */}
          <div className="settings-section">
            <h4>📊 매수 조건</h4>
            <div className="setting-item">
              <label>호재 점수 임계값 (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={config.bullish_threshold}
                onChange={(e) => setConfig({ ...config, bullish_threshold: Number(e.target.value) })}
              />
            </div>
            <div className="setting-item">
              <label>당일 상승 점수 임계값 (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={config.impact_threshold}
                onChange={(e) => setConfig({ ...config, impact_threshold: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* 투자 금액 설정 */}
          <div className="settings-section">
            <h4>💰 투자 금액</h4>
            
            {/* 현재 잔고 표시 */}
            <div className="balance-display">
              <span className="balance-label">현재 잔고:</span>
              <span className="balance-value">${currentBalance.toFixed(2)}</span>
            </div>

            <div className="setting-item">
              <label>잔고 대비 투자 비율 (%)</label>
              <input
                type="number"
                min="1"
                max="100"
                value={config.investment_percent}
                onChange={(e) => setConfig({ ...config, investment_percent: Number(e.target.value) })}
              />
            </div>
            <div className="calculated-amount">
              → ${(currentBalance * (config.investment_percent / 100)).toFixed(2)}
            </div>

            <div className="setting-item">
              <label>최대 투자 금액 ($)</label>
              <input
                type="number"
                min="0"
                step="100"
                value={config.max_investment}
                onChange={(e) => setConfig({ ...config, max_investment: Number(e.target.value) })}
              />
            </div>

            {/* 최종 투자 금액 계산 */}
            <div className="final-investment-display">
              <span className="final-label">실제 투자 금액 (작은 값 사용):</span>
              <span className="final-value">
                ${Math.min(
                  currentBalance * (config.investment_percent / 100),
                  config.max_investment
                ).toFixed(2)}
              </span>
            </div>
          </div>

          {/* 익절/손절 설정 */}
          <div className="settings-section">
            <h4>📈 익절 / 손절</h4>
            <div className="setting-item">
              <label>익절 비율 (%)</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={config.take_profit_percent}
                onChange={(e) => setConfig({ ...config, take_profit_percent: Number(e.target.value) })}
              />
            </div>
            <div className="setting-item">
              <label>손절 비율 (%)</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={config.stop_loss_percent}
                onChange={(e) => setConfig({ ...config, stop_loss_percent: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* 감지된 뉴스 */}
          <div className="settings-section detected-news-section">
            <h4>🔔 감지된 뉴스 (최근 뉴스, 매수 가능한 종목 최대 5개)</h4>
            {detectedNews.length === 0 ? (
              <div className="no-news">
                <div>현재 조건에 맞는 뉴스가 없습니다</div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
                  (호재 {config.bullish_threshold}% 이상 또는 당일상승 {config.impact_threshold}% 이상)
                </div>
              </div>
            ) : (
              <div className="news-list">
                {detectedNews.map((news) => (
                  <div key={news.n_idx} className="news-item">
                    <div className="news-header">
                      <div className="news-ticker-left">
                        <div className="ticker-symbol">{news.primaryTicker}</div>
                        {news.stockNameKo && <div className="stock-name-ko">{news.stockNameKo}</div>}
                      </div>
                      <div className="price-info">
                        {news.currentPrice !== undefined && news.currentPrice > 0 && (
                          <>
                            <div className="news-price">${news.currentPrice.toFixed(2)}</div>
                            {news.changePercent !== undefined && (
                              <div className={`change-percent ${news.changePercent >= 0 ? 'positive' : 'negative'}`}>
                                {news.changePercent >= 0 ? '▲' : '▼'} {Math.abs(news.changePercent).toFixed(2)}%
                              </div>
                            )}
                          </>
                        )}
                        {(!news.currentPrice || news.currentPrice === 0) && (
                          <div className="news-price invalid">$N/A ⚠️</div>
                        )}
                      </div>
                    </div>
                    
                    {/* 캡처 당시 가격/거래량 */}
                    {news.capturedPriceUSD && (
                      <div className="captured-info">
                        <span className="captured-label">뉴스 발생 시:</span>
                        <span className="captured-price">${news.capturedPriceUSD.toFixed(2)}</span>
                        {news.capturedVolume && (
                          <span className="captured-volume">/ 거래량: {news.capturedVolume.toLocaleString()}</span>
                        )}
                      </div>
                    )}
                    
                    <div className="news-title">{news.n_title_kr || news.n_title}</div>
                    <div className="news-scores">
                      <span className="score bullish">호재 {news.n_bullish}%</span>
                      <span className="score impact">당일상승 {news.n_immediate_impact}%</span>
                    </div>
                    
                    {/* 대체 티커가 있을 경우 선택 버튼 표시 */}
                    {news.alternateTicker && (
                      <div className="ticker-selector">
                        <button
                          className="ticker-option"
                          onClick={() => handleBuyNow(news, news.primaryTicker)}
                          disabled={!news.currentPrice || news.currentPrice === 0}
                        >
                          {news.primaryTicker} 매수
                        </button>
                        <span className="ticker-or">또는</span>
                        <button
                          className="ticker-option alternate"
                          onClick={() => handleBuyNow(news, news.alternateTicker!)}
                          disabled={!news.currentPrice || news.currentPrice === 0}
                        >
                          {news.alternateTicker} 매수
                        </button>
                      </div>
                    )}
                    
                    {/* 티커가 하나만 있을 경우 일반 매수 버튼 */}
                    {!news.alternateTicker && (
                      <button
                        className="buy-now-btn"
                        onClick={() => handleBuyNow(news)}
                        disabled={!news.currentPrice || news.currentPrice === 0}
                        title={!news.currentPrice || news.currentPrice === 0 ? '유효하지 않은 티커 (가격 조회 불가)' : ''}
                      >
                        즉시 매수
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button className="save-btn" onClick={saveConfig}>
            💾 설정 저장
          </button>
        </div>
      </div>
    </div>
  )
}

export default AutoTradingSettings

