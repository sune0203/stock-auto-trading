import React, { useState, useEffect } from 'react'
import { io, Socket } from 'socket.io-client'
import axios from 'axios'
import './TradingPage.css'
import OrderPanel from '../components/OrderPanel'
import NewsPanel from '../components/NewsPanel'
import PositionPanel from '../components/PositionPanel'
import OrderBook from '../components/OrderBook'
import MarketStatus from '../components/MarketStatus'
import AccountSwitcher from '../components/AccountSwitcher'
import AutoTradingSettings from '../components/AutoTradingSettings'
import { RefreshDouble, Hourglass } from 'iconoir-react';

interface RealTimeQuote {
  symbol: string
  price: number
  changesPercentage: number
  change: number
  dayLow: number
  dayHigh: number
  volume: number
  previousClose: number
  timestamp: number
  name?: string // 종목 영문명
}

const TradingPage: React.FC = () => {
  // URL 파라미터에서 티커 및 주문 정보 가져오기
  const getSymbolFromURL = () => {
    const params = new URLSearchParams(window.location.hash.split('?')[1])
    return params.get('symbol') || 'AAPL'
  }

  const getOrderParamsFromURL = () => {
    const params = new URLSearchParams(window.location.hash.split('?')[1])
    return {
      orderType: params.get('orderType') as 'buy' | 'sell' | null,
      priceType: params.get('priceType') as 'market' | 'limit' | null
    }
  }

  const [socket, setSocket] = useState<Socket | null>(null)
  const [selectedSymbol, setSelectedSymbol] = useState<string>(getSymbolFromURL())
  const [inputSymbol, setInputSymbol] = useState<string>(getSymbolFromURL()) // 입력 중인 심볼
  const [quote, setQuote] = useState<RealTimeQuote | null>(null)
  const [exchangeRate] = useState(1420.20) // 환율
  const [balance, setBalance] = useState<number>(0) // 매수가능금액
  const [isLoadingBalance, setIsLoadingBalance] = useState(false) // 잔고 로딩 상태
  const [currentHolding, setCurrentHolding] = useState<number>(0) // 현재 선택된 종목의 보유 수량
  const [clickedPrice, setClickedPrice] = useState<number | undefined>(undefined) // 호가 클릭 시 가격
  const [initialOrderType, setInitialOrderType] = useState<'buy' | 'sell' | undefined>(undefined) // 초기 주문 타입
  const [initialPriceType, setInitialPriceType] = useState<'market' | 'limit' | undefined>(undefined) // 초기 가격 타입
  const [stockNameKo, setStockNameKo] = useState<string>('') // 종목 한국어 이름
  const [autoTradingEnabled, setAutoTradingEnabled] = useState<boolean>(false) // 자동매수 ON/OFF
  const [showSettings, setShowSettings] = useState<boolean>(false) // 설정 팝업 표시
  const [currentTime, setCurrentTime] = useState<string>('') // 현재 시간
  const [showTooltip, setShowTooltip] = useState<boolean>(false) // 툴팁 표시
  const [autoTradingConfig, setAutoTradingConfig] = useState<any>(null) // 자동매수 설정값

  // URL 변경 감지
  useEffect(() => {
    const handleHashChange = () => {
      const newSymbol = getSymbolFromURL()
      const orderParams = getOrderParamsFromURL()
      
      setSelectedSymbol(newSymbol)
      setInputSymbol(newSymbol) // 검색창도 동기화
      
      // 주문 타입 및 가격 타입 설정
      if (orderParams.orderType) {
        setInitialOrderType(orderParams.orderType)
      }
      if (orderParams.priceType) {
        setInitialPriceType(orderParams.priceType)
      }
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // selectedSymbol 변경 시 inputSymbol 동기화
  useEffect(() => {
    setInputSymbol(selectedSymbol)
  }, [selectedSymbol])

  // 잔고 및 포지션 조회
  const fetchBalance = async () => {
    setIsLoadingBalance(true)
    try {
      const response = await fetch('http://localhost:3001/api/trading/balance')
      const data = await response.json()
      if (data.success) {
        setBalance(data.buyingPower || 0)
        setCurrentTime(formatTime(new Date())) // 잔고 조회 시 시간 업데이트
        console.log('💰 잔고 새로고침 완료')
      }
    } catch (error) {
      console.error('잔고 조회 실패:', error)
    } finally {
      setIsLoadingBalance(false)
    }
  }

  // 현재 종목의 보유 수량 조회
  const fetchCurrentHolding = async (symbol: string) => {
    try {
      const response = await fetch('http://localhost:3001/api/trading/positions')
      const positions = await response.json()
      const position = positions.find((p: any) => p.ticker === symbol)
      setCurrentHolding(position ? position.quantity : 0)
    } catch (error) {
      console.error('포지션 조회 실패:', error)
      setCurrentHolding(0)
    }
  }

  // 종목 한국어 이름 조회
  const fetchStockNameKo = async (symbol: string) => {
    try {
      const response = await axios.get(`http://localhost:3001/api/stocks/${symbol}`)
      if (response.data && response.data.s_name_kr) {
        setStockNameKo(response.data.s_name_kr)
      } else {
        setStockNameKo('')
      }
    } catch (error) {
      console.error('종목 한국어 이름 조회 실패:', error)
      setStockNameKo('')
    }
  }

  useEffect(() => {
    // 소켓 연결
    const newSocket = io('http://localhost:3001')
    setSocket(newSocket)

    // 초기 잔고 조회
    fetchBalance()

    // 자동매수 상태 조회
    loadAutoTradingStatus()

    // 자동매수 설정값 조회
    loadAutoTradingConfig()

    return () => {
      newSocket.close()
    }
  }, [])


  // 자동매수 ON/OFF 상태 로드
  const loadAutoTradingStatus = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/auto-trading/status')
      setAutoTradingEnabled(response.data.enabled)
    } catch (error) {
      console.error('자동매수 상태 로드 실패:', error)
    }
  }

  // 자동매수 설정값 로드
  const loadAutoTradingConfig = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/auto-trading/config')
      if (response.data) {
        setAutoTradingConfig(response.data)
      }
    } catch (error) {
      console.error('자동매수 설정 로드 실패:', error)
    }
  }

  // 자동매수 ON/OFF 토글
  const toggleAutoTrading = async () => {
    try {
      const newStatus = !autoTradingEnabled
      await axios.post('http://localhost:3001/api/auto-trading/toggle', { enabled: newStatus })
      setAutoTradingEnabled(newStatus)
      console.log(`🤖 자동매수: ${newStatus ? 'ON' : 'OFF'}`)
    } catch (error) {
      console.error('자동매수 토글 실패:', error)
      alert('자동매수 설정 변경에 실패했습니다.')
    }
  }

  useEffect(() => {
    if (socket && selectedSymbol) {
      console.log(`🔄 종목 변경: ${selectedSymbol}`)
      
      // 티커 변경 시 기존 quote 초기화
      setQuote(null)
      
      // 현재 종목의 보유 수량 조회
      fetchCurrentHolding(selectedSymbol)

      // 종목 한국어 이름 조회
      fetchStockNameKo(selectedSymbol)
      
      // 실시간 가격 구독 (단일 심볼)
      socket.emit('subscribe:realtime', [selectedSymbol])

      // 🔥 KIS WebSocket 호가 구독 (정규장 외 시간에도 실시간 가격 반영)
      socket.emit('subscribe:orderbook', selectedSymbol)

      // 종목 한국어 이름 매핑
      const stockNameMap: Record<string, string> = {
        'AAPL': '애플',
        'TSLA': '테슬라',
        'NVDA': '엔비디아',
        'MSFT': '마이크로소프트',
        'AMZN': '아마존',
        'GOOGL': '구글',
        'META': '메타',
        'NFLX': '넷플릭스',
        'AMD': 'AMD',
        'INTC': '인텔',
        'BYND': '비욘드 미트',
        'SMBC': 'SMBC'
      }
      setStockNameKo(stockNameMap[selectedSymbol] || '')
      
      // 즉시 가격 조회 (FMP API)
      const fetchInitialPrice = async () => {
        try {
          const response = await fetch(`http://localhost:3001/api/realtime/quote/${selectedSymbol}`)
          const data = await response.json()
          if (data && data.price) {
            const currentPrice = data.price
            const prevClose = data.previousClose || currentPrice
            
            // 실시간 가격 기준으로 변동금액/변동률 재계산
            const change = currentPrice - prevClose
            const changesPercentage = prevClose > 0 ? (change / prevClose) * 100 : 0
            
            console.log(`💵 초기 가격 조회: ${data.symbol} = $${currentPrice} (전일: $${prevClose}, 변동: ${change >= 0 ? '+' : ''}${change.toFixed(4)} / ${changesPercentage.toFixed(2)}%)`)
            
            setQuote({
              symbol: data.symbol,
              price: currentPrice,
              changesPercentage: changesPercentage,
              change: change,
              dayLow: data.dayLow || 0,
              dayHigh: data.dayHigh || 0,
              volume: data.volume || 0,
              previousClose: prevClose,
              timestamp: Date.now()
            })
          } else {
            console.error('❌ 가격 데이터 없음:', data)
          }
        } catch (err) {
          console.error('❌ 가격 조회 실패:', err)
        }
      }
      
      fetchInitialPrice()
      
      // 🔥 FMP 실시간 가격 업데이트 (프리마켓~애프터마켓 연장까지 지원)
      const handlePriceUpdate = (data: any) => {
        if (data.symbol === selectedSymbol) {
          const currentPrice = data.price
          const prevClose = data.previousClose || currentPrice
          
          // 실시간 가격 기준으로 변동금액/변동률 재계산
          const change = currentPrice - prevClose
          const changesPercentage = prevClose > 0 ? (change / prevClose) * 100 : 0
          
          console.log(`💵 [FMP 실시간] ${data.symbol} = $${currentPrice} (${change >= 0 ? '+' : ''}${change.toFixed(4)} / ${changesPercentage >= 0 ? '+' : ''}${changesPercentage.toFixed(2)}%)`)
          
          setQuote(prev => ({
            symbol: data.symbol,
            price: currentPrice,
            changesPercentage: changesPercentage,
            change: change,
            dayLow: data.dayLow || prev?.dayLow || 0,
            dayHigh: data.dayHigh || prev?.dayHigh || 0,
            volume: data.volume || prev?.volume || 0,
            previousClose: prevClose,
            timestamp: Date.now()
          }))
        }
      }
      
      socket.on('realtime:price', handlePriceUpdate)
      
      // KIS WebSocket 호가 (정규장만 참고용)
      const handleOrderbookUpdate = (data: any) => {
        if (data.symbol === selectedSymbol) {
          // 호가 데이터는 호가창에만 표시, 현재가는 FMP 우선
          console.log(`📊 [KIS 호가] ${data.symbol} - 매수: $${data.bid?.price}, 매도: $${data.ask?.price}`)
        }
      }
      
      socket.on('orderbook-update', handleOrderbookUpdate)
      
      // 주기적 가격 갱신 (2초마다, 프리마켓~애프터마켓 연장까지 실시간 반영)
      const priceRefreshInterval = setInterval(fetchInitialPrice, 2000)
      
      // 컴포넌트 언마운트 시 정리
      return () => {
        socket.emit('unsubscribe:realtime', [selectedSymbol])
        socket.emit('unsubscribe:orderbook', selectedSymbol)
        socket.off('realtime:price', handlePriceUpdate)
        socket.off('orderbook-update', handleOrderbookUpdate)
        clearInterval(priceRefreshInterval)
      }
    }
  }, [socket, selectedSymbol])

  // 가격 포맷 (소수점 자리 유지)
  const formatPrice = (price: number) => {
    // 1달러 이상: 소수점 2자리
    // 1달러 미만: 소수점 4자리
    if (price >= 1) {
      return price.toFixed(2)
    } else {
      return price.toFixed(4)
    }
  }

  // 변동률 포맷 (소수점 2자리)
  const formatChangePercent = (percent: number) => {
    return percent.toFixed(2)
  }

  // 시간 포맷 (YY.MM.DD HH:MM:SS)
  const formatTime = (date: Date) => {
    const year = date.getFullYear().toString().slice(-2)
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day = date.getDate().toString().padStart(2, '0')
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    return `${year}.${month}.${day} ${hours}:${minutes}:${seconds}`
  }

  const formatKRW = (usd: number) => {
    return (usd * exchangeRate).toLocaleString('ko-KR', { maximumFractionDigits: 0 })
  }

  // 검색창 엔터 처리
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault() // 폼 제출 방지
      const trimmedSymbol = inputSymbol.trim().toUpperCase()
      if (trimmedSymbol) {
        console.log(`🔍 종목 검색: ${trimmedSymbol}`)
        setSelectedSymbol(trimmedSymbol)
        
        // URL 업데이트 (현재 경로가 없으면 /trading 추가)
        const currentHash = window.location.hash
        const currentPath = currentHash.split('?')[0] || '#/trading'
        const newHash = `${currentPath}?symbol=${trimmedSymbol}`
        
        console.log('🔗 URL 업데이트:', {
          currentHash,
          currentPath,
          newHash
        })
        
        window.location.hash = newHash
      }
    }
  }

  return (
    <div className="trading-page">
      {/* 헤더 */}
      <header className="trading-header">
        {/* 헤더 상단 */}
        <div className="header_top">
          {/* 종목 검색 */}
          <div className="header-search">
            <h1 className="logo">종목 검색</h1>
            <div className="symbol-selector">
              <input
                type="text"
                value={inputSymbol}
                onChange={(e) => setInputSymbol(e.target.value.toUpperCase())}
                onKeyDown={handleSearchKeyDown}
                placeholder="종목 검색 (엔터)"
                className="symbol-input"
              />
            </div>
          </div>
          {/* 자동매수 컨트롤 */}
          <div className="header-auto-trading">
            <div className="auto-trading-controls">
              <div className="auto-trading-toggle">
                <span className="toggle-label">자동매수</span>
                <span className={`toggle-status ${autoTradingEnabled ? 'on' : 'off'}`}>
                  {autoTradingEnabled ? 'ON' : 'OFF'}
                </span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={autoTradingEnabled}
                    onChange={toggleAutoTrading}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
              <button
                className="settings-btn"
                onClick={() => setShowSettings(true)}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                title="자동매수 설정"
              >
                ⚙️
                {showTooltip && autoTradingConfig && (
                  <div className="settings-tooltip">
                    <div className="tooltip-content">
                      <div className="tooltip-title">🤖 자동매수 설정</div>
                      
                      <div className="tooltip-section">
                        <div className="tooltip-section-title">매수 조건</div>
                        <div className="tooltip-row">
                          <span className="tooltip-label">호재 점수 임계값:</span>
                          <span className="tooltip-value">{autoTradingConfig.bullishThreshold}%</span>
                        </div>
                        <div className="tooltip-row">
                          <span className="tooltip-label">즉시 영향 점수 임계값:</span>
                          <span className="tooltip-value">{autoTradingConfig.immediateImpactThreshold}%</span>
                        </div>
                      </div>

                      <div className="tooltip-section">
                        <div className="tooltip-section-title">익절 / 손절</div>
                        <div className="tooltip-row">
                          <span className="tooltip-label">익절 비율:</span>
                          <span className="tooltip-value">{autoTradingConfig.takeProfitPercent}%</span>
                        </div>
                        <div className="tooltip-row">
                          <span className="tooltip-label">손절 비율:</span>
                          <span className="tooltip-value">{autoTradingConfig.stopLossPercent}%</span>
                        </div>
                      </div>

                      <div className="tooltip-section">
                        <div className="tooltip-section-title">투자 금액</div>
                        <div className="tooltip-row">
                          <span className="tooltip-label">거래당 최대 투자 금액:</span>
                          <span className="tooltip-value">${autoTradingConfig.maxInvestmentPerTrade}</span>
                        </div>
                        <div className="tooltip-row">
                          <span className="tooltip-label">하루 최대 거래 횟수:</span>
                          <span className="tooltip-value">{autoTradingConfig.maxDailyTrades}회</span>
                        </div>
                      </div>

                      <div className="tooltip-status">
                        현재 상태: <span className={autoTradingEnabled ? 'status-on' : 'status-off'}>
                          {autoTradingEnabled ? 'ON' : 'OFF'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </button>
            </div>
          </div>


        </div>
        {/* 헤더 하단 */}
        <div className='header_bottom'>
          {/* 종목 정보 */}
          <div className="stock-info">
            <div className="stock-name-section">
              <div className="stock-name-row">
                <h2 className="stock-ticker">{selectedSymbol}</h2>
                {stockNameKo && <span className="stock-name-ko">{stockNameKo}</span>}
              </div>
            </div>
            <div className="stock-price">
              <div className="current-price">
                <span className="price-value">${quote ? formatPrice(quote.price) : '---'}</span>
                <span className="price-krw">{quote ? formatKRW(quote.price) : '---'}원</span>

              </div>
              {quote && (
                <div className={`price-change ${quote.change >= 0 ? 'positive' : 'negative'}`}>
                  <span className="change-amount">
                    {quote.change >= 0 ? '+' : ''}{formatPrice(quote.change)}
                  </span>
                  <span className="change-percent">
                    ({quote.changesPercentage >= 0 ? '+' : ''}{formatChangePercent(quote.changesPercentage)}%)
                  </span>
                  <span className="previous-close" title="전일 종가">
                    (전일: ${formatPrice(quote.previousClose)})
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* 계정 전환 */}
          <AccountSwitcher />
          {/* 시장 상태 표시 */}
          <MarketStatus />
          
          {/* 정보 */}
          <div className="balance-info">
            <span className="balance-label">매수 가능</span>
            <span className="balance-amount">${balance.toLocaleString()}</span>
            <span className="balance-krw">
              {(balance * exchangeRate).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원
            </span>
            <p className="balance-time">/ {currentTime} 기준</p>
            <button 
              className="refresh-balance-btn"
              onClick={fetchBalance}
              disabled={isLoadingBalance}
              title="잔고 새로고침"
            >
              {isLoadingBalance ? <span className="loading-icon"><Hourglass strokeWidth={2}/></span> : <span className="refresh-icon"><RefreshDouble strokeWidth={2}/></span>}
            </button>
          </div>

        </div>
      </header>

      {/* 메인 컨텐츠 - 4분할 (호가 | 주문 | 포지션 | 뉴스) */}
      <div className="trading-content">
        {/* 1. 호가창 */}
        <div className="panel panel-orderbook">
          
          <OrderBook 
            symbol={selectedSymbol} 
            currentPrice={quote?.price || 0}
            onPriceClick={(price) => {
              console.log(`💰 호가 클릭: $${price}`)
              setClickedPrice(price)
            }}
          />
        </div>

        {/* 2. 주문 패널 */}
        <div className="panel panel-order">
          <OrderPanel 
            symbol={selectedSymbol} 
            currentPrice={quote?.price || 0}
            exchangeRate={exchangeRate}
            balance={balance}
            currentHolding={currentHolding}
            initialPrice={clickedPrice}
            initialOrderType={initialOrderType}
            initialPriceType={initialPriceType}
            onOrderComplete={() => {
              console.log(`🔄 [TradingPage] 주문 완료 콜백 실행`)
              console.log(`   - 잔고 새로고침 시작`)
              fetchBalance()
              console.log(`   - 포지션 새로고침 시작: ${selectedSymbol}`)
              fetchCurrentHolding(selectedSymbol)
              console.log(`   - UI 상태 초기화`)
              setClickedPrice(undefined)
              setInitialOrderType(undefined)
              setInitialPriceType(undefined)
              console.log(`✓ [TradingPage] 주문 완료 콜백 종료`)
            }}
          />
        </div>

        {/* 3. 보유 포지션 */}
        <div className="panel panel-position">
          <PositionPanel 
            exchangeRate={exchangeRate}
            onBuyClick={(ticker) => {
              console.log(`📊 추가 구매: ${ticker}`)
              setSelectedSymbol(ticker)
              setInitialOrderType('buy')
              window.location.hash = `#/trading?symbol=${ticker}`
            }}
            onSellClick={(ticker) => {
              console.log(`📊 판매: ${ticker}`)
              setSelectedSymbol(ticker)
              setInitialOrderType('sell')
              window.location.hash = `#/trading?symbol=${ticker}`
            }}
          />
        </div>

        {/* 4. 실시간 뉴스 */}
        <div className="panel panel-news">
          <NewsPanel 
            onTickerClick={(ticker) => {
              console.log(`📰 뉴스에서 종목 선택: ${ticker}`)
              setSelectedSymbol(ticker)
              window.location.hash = `#/trading?symbol=${ticker}`
            }}
          />
        </div>
      </div>

      {/* 자동매수 설정 팝업 */}
      {showSettings && (
        <AutoTradingSettings onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}

export default TradingPage

