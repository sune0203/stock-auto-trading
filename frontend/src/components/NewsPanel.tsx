import React, { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import './NewsPanel.css'

interface NewsItem {
  id: string
  title: string
  titleKo?: string
  description: string
  descriptionKo?: string
  url: string
  source: string
  imageUrl?: string
  publishedTime: string
  ticker?: string
  primaryTicker?: string // 우선 티커
  alternateTicker?: string | null // 대체 티커
  n_ticker?: string
  n_symbol?: string
  n_summary_kr?: string // 한글 요약
  n_link?: string // 원문 링크
  n_immediate_impact?: number // 당일 상승 점수
  n_bullish?: number // 호재 점수
  capturedPriceUSD?: number | null // 뉴스 캡처 당시 가격 (USD)
  capturedVolume?: number | null // 뉴스 캡처 당시 거래량
  analysis?: {
    ticker?: string
    positivePercentage?: number
    negativePercentage?: number
    riseScore?: number
    grade?: string
  }
}

interface NewsPanelProps {
  onTickerClick?: (ticker: string) => void
}

const NewsPanel: React.FC<NewsPanelProps> = ({ onTickerClick }) => {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [newNewsCount, setNewNewsCount] = useState(0) // 새 뉴스 개수
  const [expandedNews, setExpandedNews] = useState<Set<string>>(new Set()) // 펼쳐진 뉴스 ID

  // 뉴스 불러오기 (최근 30개만)
  const fetchNews = async () => {
    setLoading(true)
    try {
      const response = await fetch(`http://localhost:3001/api/news`)
      const data = await response.json()
      
      if (data.news) {
        setNews(data.news)
        console.log(`📰 뉴스 ${data.news.length}개 로드`)
      }
    } catch (error) {
      console.error('뉴스 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  // 초기 로드
  useEffect(() => {
    fetchNews()
  }, [])

  // WebSocket 연결 및 실시간 뉴스 수신
  useEffect(() => {
    const newSocket = io('http://localhost:3001')
    setSocket(newSocket)

    // 신규 뉴스 수신
    newSocket.on('news:new', (newNewsItems: NewsItem[]) => {
      console.log(`📰 신규 뉴스 ${newNewsItems.length}개 수신`)
      
      setNews(prev => {
        // 중복 제거: 기존 뉴스에 없는 것만 추가
        const existingIds = new Set(prev.map(item => item.id))
        const uniqueNewNews = newNewsItems.filter(item => !existingIds.has(item.id))
        
        if (uniqueNewNews.length > 0) {
          // 새 뉴스 개수 증가
          setNewNewsCount(prevCount => prevCount + uniqueNewNews.length)
          
          // 새 뉴스를 맨 위에 추가하고, 최대 30개만 유지
          return [...uniqueNewNews, ...prev].slice(0, 30)
        }
        return prev
      })
    })

    return () => {
      newSocket.close()
    }
  }, [])

  // 시간 포맷팅
  const formatTime = (timeStr: string) => {
    if (!timeStr) return ''
    try {
      const date = new Date(timeStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffMins < 1) return '방금 전'
      if (diffMins < 60) return `${diffMins}분 전`
      if (diffHours < 24) return `${diffHours}시간 전`
      if (diffDays < 7) return `${diffDays}일 전`
      
      return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
    } catch {
      return timeStr
    }
  }

  // 뉴스 카드 클릭
  const handleNewsClick = (item: NewsItem) => {
    if (item.primaryTicker && onTickerClick) {
      onTickerClick(item.primaryTicker)
    } else if (item.analysis?.ticker && onTickerClick) {
      onTickerClick(item.analysis.ticker)
    }
  }

  // 티커 선택 클릭
  const handleTickerSelect = (ticker: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if (onTickerClick) {
      onTickerClick(ticker)
    }
  }

  // 요약 토글
  const toggleSummary = (newsId: string, event: React.MouseEvent) => {
    event.stopPropagation() // 뉴스 카드 클릭 이벤트 방지
    setExpandedNews(prev => {
      const newSet = new Set(prev)
      if (newSet.has(newsId)) {
        newSet.delete(newsId)
      } else {
        newSet.add(newsId)
      }
      return newSet
    })
  }

  // 원문 이동
  const openOriginalLink = (link: string, event: React.MouseEvent) => {
    event.stopPropagation() // 뉴스 카드 클릭 이벤트 방지
    window.open(link, '_blank', 'noopener,noreferrer')
  }

  // 스크롤 시 새 뉴스 배지 초기화
  const handleScroll = () => {
    if (newNewsCount > 0) {
      setNewNewsCount(0)
    }
  }

  return (
    <div className="news-panel">
      <div className="news-header">
        <h3>실시간 뉴스</h3>
        <div className="news-header-right">
          {newNewsCount > 0 && (
            <span className="new-news-badge">+{newNewsCount} 새 뉴스</span>
          )}
          <span className="news-count">{news.length}개</span>
        </div>
      </div>

      {loading && <div className="news-loading">로딩 중...</div>}

      <div className="news-list" onScroll={handleScroll}>
        {news.length === 0 && !loading && (
          <div className="news-empty">표시할 뉴스가 없습니다</div>
        )}
        {news.map((item) => {
          const isExpanded = expandedNews.has(item.id)
          return (
            <div 
              key={item.id} 
              className="news-item"
              onClick={() => handleNewsClick(item)}
            >
              <div className="news-content">
                <div className="news-title">
                  {item.titleKo || item.title}
                </div>
                <div className="news-meta">
                  <span className="news-source">{item.source}</span>
                  <span className="news-time">{formatTime(item.publishedTime)}</span>
                  {item.primaryTicker && (
                    <span className="news-ticker">{item.primaryTicker}</span>
                  )}
                </div>

                {/* 캡처 당시 가격/거래량 */}
                {item.capturedPriceUSD && (
                  <div className="captured-info-panel">
                    <span className="captured-label">뉴스 발생 시:</span>
                    <span className="captured-price">${item.capturedPriceUSD.toFixed(2)}</span>
                    {item.capturedVolume && (
                      <span className="captured-volume">/ 거래량: {item.capturedVolume.toLocaleString()}</span>
                    )}
                  </div>
                )}

                {/* 점수 표시 */}
                <div className="news-scores">
                  {item.n_immediate_impact != null && (
                    <span className="score-badge impact">
                      당일상승 {item.n_immediate_impact.toFixed(1)}
                    </span>
                  )}
                  {item.n_bullish != null && (
                    <span className={`score-badge bullish ${item.n_bullish > 0 ? 'positive' : 'negative'}`}>
                      호재 {item.n_bullish > 0 ? '+' : ''}{item.n_bullish.toFixed(1)}
                    </span>
                  )}
                </div>

                {/* 요약 내용 (펼쳐졌을 때만 표시) */}
                {isExpanded && item.n_summary_kr && (
                  <div className="news-summary">
                    {item.n_summary_kr}
                  </div>
                )}

                {/* 티커 선택 버튼 (대체 티커가 있을 경우) */}
                {item.alternateTicker && (
                  <div className="ticker-selector-panel">
                    <button 
                      className="ticker-option-panel"
                      onClick={(e) => handleTickerSelect(item.primaryTicker!, e)}
                    >
                      {item.primaryTicker} 차트
                    </button>
                    <span className="ticker-or">또는</span>
                    <button 
                      className="ticker-option-panel alternate"
                      onClick={(e) => handleTickerSelect(item.alternateTicker!, e)}
                    >
                      {item.alternateTicker} 차트
                    </button>
                  </div>
                )}

                {/* 버튼 그룹 */}
                <div className="news-actions">
                  {item.n_summary_kr && (
                    <button 
                      className="news-btn summary-btn"
                      onClick={(e) => toggleSummary(item.id, e)}
                    >
                      {isExpanded ? '요약 접기' : '요약 보기'}
                    </button>
                  )}
                  {item.n_link && (
                    <button 
                      className="news-btn link-btn"
                      onClick={(e) => openOriginalLink(item.n_link!, e)}
                    >
                      원문 이동
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default NewsPanel
