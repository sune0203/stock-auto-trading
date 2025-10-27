import React, { useState, useEffect } from 'react'
import { io, Socket } from 'socket.io-client'
import './TradingPage.css'
import OrderPanel from '../components/OrderPanel'
import NewsPanel from '../components/NewsPanel'
import PositionPanel from '../components/PositionPanel'
import OrderBook from '../components/OrderBook'
import MarketStatus from '../components/MarketStatus'
import AccountSwitcher from '../components/AccountSwitcher'

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
  // URL 파라미터에서 티커 가져오기
  const getSymbolFromURL = () => {
    const params = new URLSearchParams(window.location.hash.split('?')[1])
    return params.get('symbol') || 'AAPL'
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
  const [stockNameKo, setStockNameKo] = useState<string>('') // 종목 한국어 이름

  // URL 변경 감지
  useEffect(() => {
    const handleHashChange = () => {
      const newSymbol = getSymbolFromURL()
      setSelectedSymbol(newSymbol)
      setInputSymbol(newSymbol) // 검색창도 동기화
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

  useEffect(() => {
    // 소켓 연결
    const newSocket = io('http://localhost:3001')
    setSocket(newSocket)

    // 초기 잔고 조회
    fetchBalance()

    return () => {
      newSocket.close()
    }
  }, [])

  useEffect(() => {
    if (socket && selectedSymbol) {
      console.log(`🔄 종목 변경: ${selectedSymbol}`)
      
      // 티커 변경 시 기존 quote 초기화
      setQuote(null)
      
      // 현재 종목의 보유 수량 조회
      fetchCurrentHolding(selectedSymbol)
      
      // 실시간 가격 구독 (단일 심볼)
      socket.emit('subscribe:realtime', [selectedSymbol])

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
            console.log(`💵 초기 가격 조회: ${data.symbol} = $${data.price}`)
            setQuote({
              symbol: data.symbol,
              price: data.price,
              changesPercentage: data.changesPercentage || 0,
              change: data.change || 0,
              dayLow: data.dayLow || 0,
              dayHigh: data.dayHigh || 0,
              volume: data.volume || 0,
              previousClose: data.previousClose || data.price - (data.change || 0),
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
      
      // 실시간 가격 업데이트 리스너
      const handlePriceUpdate = (data: any) => {
        if (data.symbol === selectedSymbol) {
          console.log(`💵 [실시간] ${data.symbol} = $${data.price}`)
          setQuote(prev => ({
            symbol: data.symbol,
            price: data.price,
            changesPercentage: data.changesPercentage || prev?.changesPercentage || 0,
            change: data.change || prev?.change || 0,
            dayLow: data.dayLow || prev?.dayLow || 0,
            dayHigh: data.dayHigh || prev?.dayHigh || 0,
            volume: data.volume || prev?.volume || 0,
            previousClose: data.previousClose || prev?.previousClose || data.price,
            timestamp: Date.now()
          }))
        }
      }
      
      socket.on('realtime:price', handlePriceUpdate)
      
      // 주기적 가격 갱신 (5초마다, 실시간이 작동하지 않을 경우 대비)
      const priceRefreshInterval = setInterval(fetchInitialPrice, 5000)
      
      // 컴포넌트 언마운트 시 정리
      return () => {
        socket.emit('unsubscribe:realtime', [selectedSymbol])
        socket.off('realtime:price', handlePriceUpdate)
        clearInterval(priceRefreshInterval)
      }
    }
  }, [socket, selectedSymbol])

  const formatPrice = (price: number) => {
    return price.toFixed(2)
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
        <div className="header-left">
          <h1 className="logo">NASDAQ Trading</h1>
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

                  {/* 종목 정보 */}
                  <div className="stock-info">
            <div className="stock-name">
              <h2>{selectedSymbol}</h2>
            </div>
            <div className="stock-price">
              <div className="current-price">
                ${quote ? formatPrice(quote.price) : '---'}
                <span className="price-krw">
                  {quote ? formatKRW(quote.price) : '---'}원
                </span>
                {quote && (
                  <span className="price-source" title="정규장 마감 가격 (장외거래 가격은 반영되지 않음)">
                    📊 정규장
                  </span>
                )}
              </div>
              <div className={`price-change ${quote && quote.change >= 0 ? 'positive' : 'negative'}`}>
                {quote && (
                  <>
                    <span className="change-amount">
                      {quote.change >= 0 ? '+' : ''}{formatPrice(quote.change)}
                    </span>
                    <span className="change-percent">
                      ({quote.changesPercentage >= 0 ? '+' : ''}{quote.changesPercentage.toFixed(2)}%)
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

        <div className="header-right">
          {/* 계정 전환 */}
          <AccountSwitcher />
          
          {/* 시장 상태 표시 */}
          <MarketStatus />
          
          <div className="balance-info">
            <span className="balance-label">매수 가능</span>
            <span className="balance-amount">${balance.toLocaleString()}</span>
            <span className="balance-krw">
              {(balance * exchangeRate).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원
            </span>
            <button 
              className="refresh-balance-btn"
              onClick={fetchBalance}
              disabled={isLoadingBalance}
              title="잔고 새로고침"
            >
              {isLoadingBalance ? '⏳' : '🔄'}
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
            onOrderComplete={() => {
              console.log(`🔄 [TradingPage] 주문 완료 콜백 실행`)
              console.log(`   - 잔고 새로고침 시작`)
              fetchBalance()
              console.log(`   - 포지션 새로고침 시작: ${selectedSymbol}`)
              fetchCurrentHolding(selectedSymbol)
              console.log(`   - UI 상태 초기화`)
              setClickedPrice(undefined)
              setInitialOrderType(undefined)
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
    </div>
  )
}

export default TradingPage

