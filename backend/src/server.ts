import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { TradingManager } from './trading-manager.js'
import { FMPApi } from './fmp-api.js'
import { LocalSymbolMatcher } from './local-symbol-matcher.js'
import { getTradingHistory, saveTradingRecord, TradingRecord, getNewsPaginated, NewsFromDB, watchNewsDB, savePendingOrder, getPendingOrders, saveDBPosition, updatePendingOrderStatus, getAutoTradingConfig, saveAutoTradingConfig, toggleAutoTrading } from './db.js'
import { fmpRealTimeApi } from './fmp-realtime.js'
import { chartCacheService } from './chart-cache.js'
import { accountCacheService } from './account-cache.js'
import { OrderMonitor } from './order-monitor.js'
import { kisWebSocketService } from './kis-websocket.js'
import { autoTradingService } from './auto-trading.js'
import { kisSyncService } from './kis-sync-service.js'

console.log(`💾 데이터 소스: MySQL DB (${process.env.DB_HOST})`)

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
})

app.use(cors())
app.use(express.json())

// FMP API 초기화
const fmpApi = new FMPApi()

// 로컬 심볼 매처 초기화
const localMatcher = new LocalSymbolMatcher()

// 트레이딩 매니저 초기화
const tradingManager = new TradingManager()

// 주문 감시 서비스 (나중에 초기화)
let orderMonitor: OrderMonitor

// 차트 데이터 API (KIS API 우선, FMP 폴백)
app.get('/api/chart/historical/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params
    const days = parseInt(req.query.days as string) || 30
    
    // 1. KIS API로 일봉 데이터 시도
    try {
      const kisData = await tradingManager.getKISApi().getOverseasDailyChart(ticker, 'NASD', 'D', days)
      if (kisData && kisData.length > 0) {
        console.log(`📊 KIS 일봉 데이터 사용: ${ticker} (${kisData.length}개)`)
        // 날짜 포맷 변환 (YYYYMMDD -> YYYY-MM-DD)
        const formattedData = kisData.map((item: any) => ({
          date: `${item.date.slice(0, 4)}-${item.date.slice(4, 6)}-${item.date.slice(6, 8)}`,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
          volume: item.volume
        }))
        return res.json(formattedData)
      }
    } catch (kisError) {
      console.log(`⚠️ KIS 일봉 조회 실패, FMP로 폴백: ${ticker}`)
    }
    
    // 2. FMP API로 폴백 (캐싱 적용)
    const data = await chartCacheService.getChartData(ticker, '1day', days)
    res.json(data)
  } catch (error) {
    console.error('히스토리컬 데이터 조회 오류:', error)
    res.status(500).json({ error: 'Failed to fetch historical data' })
  }
})

app.get('/api/chart/intraday/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params
    const { interval } = req.query // '1min', '3min', '5min', '15min', '30min', '1hour'
    
    // interval을 분 단위로 변환
    const intervalMinutes = interval === '1min' ? 1
                          : interval === '3min' ? 3
                          : interval === '5min' ? 5
                          : interval === '15min' ? 15
                          : interval === '30min' ? 30
                          : interval === '1hour' ? 60
                          : 5
    
    // 1. KIS API로 분봉 데이터 시도
    try {
      const kisData = await tradingManager.getKISApi().getOverseasChartData(ticker, 'NASD', intervalMinutes, 120)
      if (kisData && kisData.length > 0) {
        console.log(`📊 KIS 분봉 데이터 사용: ${ticker} ${intervalMinutes}분 (${kisData.length}개)`)
        // 날짜/시간 포맷 변환
        const formattedData = kisData.map((item: any) => {
          const date = item.date // YYYYMMDD
          const time = item.time // HHMMSS
          return {
            date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
            volume: item.volume
          }
        })
        return res.json(formattedData)
      }
    } catch (kisError) {
      console.log(`⚠️ KIS 분봉 조회 실패, FMP로 폴백: ${ticker}`)
    }
    
    // 2. FMP API로 폴백 (캐싱 적용)
    const days = interval === '1min' ? 5 
               : interval === '5min' ? 30 
               : interval === '15min' ? 90 
               : 30
    const data = await chartCacheService.getChartData(ticker, interval as string || '5min', days)
    res.json(data)
  } catch (error) {
    console.error('인트라데이 데이터 조회 오류:', error)
    res.status(500).json({ error: 'Failed to fetch intraday data' })
  }
})

// 서버 시작 시 KIS API 토큰 미리 발급 및 초기화
async function initializeServices() {
  try {
    // KIS API Manager 초기화
    console.log('🔧 KIS API Manager 초기화 중...')
    await kisApiManager.initialize()
    
    console.log('🔑 KIS API 토큰 사전 발급 중...')
    await tradingManager.getKISApi().getAccessToken()
    console.log('✅ KIS API 토큰 사전 발급 완료')
    
    // 토큰 발급 후 모니터링 시작
    tradingManager.startMonitoring(5) // 5분마다 포지션 체크
    
    // KIS 데이터 동기화 서비스 시작
    kisSyncService.start()
  } catch (error) {
    console.error('❌ 서비스 초기화 실패:', error)
  }
}

// WebSocket 연결 처리
io.on('connection', (socket) => {
  console.log('💼 클라이언트 연결:', socket.id)
  
  // 실시간 호가 구독 요청
  socket.on('subscribe-orderbook', async (symbol: string) => {
    try {
      console.log(`📊 호가 구독 요청: ${symbol}`)
      
      // KIS WebSocket 연결 (아직 연결되지 않은 경우)
      if (!kisWebSocketService.getConnectionStatus()) {
        await kisWebSocketService.connect()
      }
      
      // 종목 구독
      await kisWebSocketService.subscribe(symbol)
      
      // 소켓을 방에 추가 (해당 종목 구독자 그룹)
      socket.join(`orderbook-${symbol}`)
      
      socket.emit('orderbook-subscribed', { symbol, success: true })
  } catch (error) {
      console.error(`❌ 호가 구독 실패: ${symbol}`, error)
      socket.emit('orderbook-subscribed', { symbol, success: false, error: String(error) })
    }
  })
  
  // 실시간 호가 구독 해제
  socket.on('unsubscribe-orderbook', async (symbol: string) => {
    try {
      console.log(`📊 호가 구독 해제: ${symbol}`)
      
      // 소켓을 방에서 제거
      socket.leave(`orderbook-${symbol}`)
      
      // 해당 종목을 구독하는 클라이언트가 없으면 KIS 구독 해제
      const room = io.sockets.adapter.rooms.get(`orderbook-${symbol}`)
      if (!room || room.size === 0) {
        await kisWebSocketService.unsubscribe(symbol)
      }
      
      socket.emit('orderbook-unsubscribed', { symbol, success: true })
    } catch (error) {
      console.error(`❌ 호가 구독 해제 실패: ${symbol}`, error)
      socket.emit('orderbook-unsubscribed', { symbol, success: false, error: String(error) })
    }
  })
  
  socket.on('disconnect', () => {
    console.log('💼 클라이언트 연결 해제:', socket.id)
  })
})

// KIS WebSocket 호가 데이터 수신 시 Socket.IO로 브로드캐스트
kisWebSocketService.onData((data) => {
  // 종목 코드 추출 (예: NASDAAPL -> AAPL)
  const symbol = data.symb.replace(/^[A-Z]{4}/, '') // 앞 4자리 제거
  
  // 해당 종목을 구독하는 클라이언트들에게 브로드캐스트
  io.to(`orderbook-${symbol}`).emit('orderbook-update', {
    symbol,
    timestamp: new Date().toISOString(),
    bid: {
      price: parseFloat(data.pbid1),
      quantity: parseInt(data.vbid1),
      total: parseFloat(data.bvol)
    },
    ask: {
      price: parseFloat(data.pask1),
      quantity: parseInt(data.vask1),
      total: parseFloat(data.avol)
    }
  })
})

// DB 뉴스 변경 감지 및 실시간 브로드캐스트
const startNewsWatcher = () => {
  console.log('📡 뉴스 DB 감시 시작...')
  
  watchNewsDB((newNews: NewsFromDB[]) => {
    // 새로운 뉴스를 프론트엔드 형식으로 변환
    const formattedNews = newNews.map((dbNews: NewsFromDB) => ({
      id: dbNews.n_idx.toString(),
      title: dbNews.n_title,
      titleKo: dbNews.n_title_kr || dbNews.n_title,
      description: dbNews.n_summary,
      descriptionKo: dbNews.n_summary_kr || dbNews.n_summary,
      url: dbNews.n_link,
      source: dbNews.n_source,
      imageUrl: dbNews.n_image,
      publishedTime: dbNews.n_time_kst || dbNews.n_save_time || '',
      ticker: dbNews.n_ticker,
      n_summary_kr: dbNews.n_summary_kr, // 한글 요약
      n_link: dbNews.n_link, // 원문 링크
      n_immediate_impact: dbNews.n_immediate_impact, // 당일 상승 점수
      n_bullish: dbNews.n_bullish, // 호재 점수
      analysis: {
        ticker: dbNews.n_ticker,
        positivePercentage: dbNews.n_bullish || 0,
        negativePercentage: dbNews.n_bearish || 0,
        riseScore: dbNews.n_bullish_potential || 0,
        grade: 'A'
      }
    }))
    
    // 모든 연결된 클라이언트에게 새 뉴스 전송
    io.emit('news:new', formattedNews)
    console.log(`📰 신규 뉴스 ${formattedNews.length}개 브로드캐스트`)
  }, 5000) // 5초마다 체크
}

// 실시간 시세 API (KIS API 우선, FMP 폴백)
app.get('/api/realtime/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params
    
    // 1. FMP API로 시세 조회 (프리마켓~애프터마켓 연장까지 지원)
    // FMP의 getCurrentPrice는 내부적으로 /quote + /aftermarket-trade를 순차 호출
    const currentPrice = await fmpRealTimeApi.getCurrentPrice(symbol)
    
    if (currentPrice) {
      // FMP 전체 quote 정보도 가져오기
      const fullQuote = await fmpRealTimeApi.getQuote(symbol)
      
      if (fullQuote) {
        // 현재가를 getCurrentPrice로 덮어쓰기 (애프터마켓 반영)
        fullQuote.price = currentPrice
        console.log(`💵 [FMP] ${symbol} = $${currentPrice}`)
        return res.json(fullQuote)
      }
      
      // fullQuote가 없으면 최소한 가격만이라도 반환
      return res.json({
        symbol,
        price: currentPrice,
        changesPercentage: 0,
        change: 0,
        dayLow: currentPrice,
        dayHigh: currentPrice,
        volume: 0,
        marketCap: 0,
        exchange: 'NASDAQ',
        timestamp: Date.now()
      })
    }
    
    // 2. FMP도 실패하면 null 반환
    console.log(`❌ [FMP] ${symbol} 가격 조회 실패`)
    res.status(404).json({ error: 'Price not available' })
  } catch (error) {
    console.error('실시간 시세 조회 오류:', error)
    res.status(500).json({ error: 'Failed to fetch quote' })
  }
})

app.get('/api/realtime/quotes', async (req, res) => {
  try {
    const symbols = (req.query.symbols as string)?.split(',') || []
    const quotes = await fmpRealTimeApi.getQuotes(symbols)
    res.json(quotes)
  } catch (error) {
    console.error('실시간 시세 조회 오류:', error)
    res.status(500).json({ error: 'Failed to fetch quotes' })
  }
})

app.get('/api/trading/config', (req, res) => {
  res.json(tradingManager.getConfig())
})

// 뉴스 조회 API (페이징)
app.get('/api/news', async (req, res) => {
  try {
    // 최근 30개만 조회 (페이지네이션 제거)
    const result = await getNewsPaginated(1, 30)
    
    // NewsFromDB를 프론트엔드 형식으로 변환
    const formattedNews = result.news.map((dbNews: any) => {
      // n_ticker 또는 n_symbol 중 우선 티커 결정
      const primaryTicker = dbNews.n_ticker || dbNews.n_symbol
      const alternateTicker = (dbNews.n_ticker && dbNews.n_symbol && dbNews.n_ticker !== dbNews.n_symbol) 
        ? (dbNews.n_ticker ? dbNews.n_symbol : dbNews.n_ticker) 
        : null
      
      // KRW → USD 환산 (captured_price)
      const capturedPriceUSD = dbNews.captured_price ? Number(dbNews.captured_price) / 1437.7 : null
      const capturedVolume = dbNews.trade_volume ? Number(dbNews.trade_volume) : null
      
      return {
        id: dbNews.n_idx.toString(),
        title: dbNews.n_title,
        titleKo: dbNews.n_title_kr || dbNews.n_title,
        description: dbNews.n_summary,
        descriptionKo: dbNews.n_summary_kr || dbNews.n_summary,
        url: dbNews.n_link,
        source: dbNews.n_source,
        imageUrl: dbNews.n_image,
        publishedTime: dbNews.n_time_kst || dbNews.n_save_time || '',
        ticker: primaryTicker, // 우선 티커
        primaryTicker, // 우선 티커
        alternateTicker, // 대체 티커
        n_ticker: dbNews.n_ticker,
        n_symbol: dbNews.n_symbol,
        n_summary_kr: dbNews.n_summary_kr, // 한글 요약
        n_link: dbNews.n_link, // 원문 링크
        n_immediate_impact: dbNews.n_immediate_impact, // 당일 상승 점수
        n_bullish: dbNews.n_bullish, // 호재 점수
        capturedPriceUSD, // 뉴스 캡처 당시 가격 (USD)
        capturedVolume, // 뉴스 캡처 당시 거래량
        analysis: {
          ticker: primaryTicker,
          positivePercentage: dbNews.n_bullish || 0,
          negativePercentage: dbNews.n_bearish || 0,
          riseScore: dbNews.n_bullish_potential || 0,
          grade: 'A'
        }
      }
    })
    
    res.json({
      news: formattedNews,
      total: result.total
    })
  } catch (error) {
    console.error('뉴스 조회 오류:', error)
    res.status(500).json({ error: 'Failed to fetch news' })
  }
})

// 잔고 조회 API (KIS API 직접 호출 with 캐싱)
app.get('/api/trading/balance', async (req, res) => {
  try {
    // accountCacheService를 사용하되, 포지션은 _POSITIONS 테이블에서만 관리
    const balance = await accountCacheService.getBalance()
    res.json({
      success: true,
      buyingPower: balance.buyingPower,
      totalBalance: balance.totalBalance,
      cash: balance.cash
    })
  } catch (error) {
    console.error('잔고 조회 오류:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch balance'
    })
  }
})

// KIS 데이터 수동 동기화 API
app.post('/api/trading/sync', async (req, res) => {
  try {
    console.log('🔄 수동 동기화 요청')
    await kisSyncService.manualSync()
    
    // 동기화 완료 후 최신 데이터 반환
    const balance = await accountCacheService.getBalance()
    const positions = await accountCacheService.getPositions()
    
    res.json({
      success: true,
      message: 'KIS 데이터 동기화 완료',
      data: {
        balance,
        positionCount: positions.length
      }
    })
  } catch (error) {
    console.error('동기화 오류:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to sync KIS data'
    })
  }
})

// 거래 히스토리 API (DB 기반)
app.get('/api/trading/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100
    const currentAccount = kisApiManager.getCurrentAccount()
    const accountType = currentAccount?.ka_type
    
    console.log(`📜 거래내역 조회 요청 (${accountType})`)
    const history = await getTradingHistory(limit, accountType)
    console.log(`📋 조회된 거래내역: ${history.length}개`)
    
    if (history.length > 0) {
      console.log(`   최근 거래: ${history[0].th_ticker} (${history[0].th_type}) - ${history[0].th_account_type}`)
  } else {
      console.log(`⚠️ 거래내역이 비어있습니다. DB를 확인하세요.`)
  }
  
    res.json(history)
  } catch (error) {
    console.error('거래 히스토리 조회 오류:', error)
    res.status(500).json({ error: 'Failed to fetch trading history' })
  }
})
  
// 거래 기록 저장 API
app.post('/api/trading/record', async (req, res) => {
  try {
    const record: TradingRecord = req.body
    await saveTradingRecord(record)
  res.json({ success: true })
  } catch (error) {
    console.error('거래 기록 저장 오류:', error)
    res.status(500).json({ error: 'Failed to save trading record' })
  }
})

// 포지션 조회 API (KIS API 기반)
app.get('/api/trading/positions', async (req, res) => {
  try {
    // KIS API에서 실제 포지션 조회 (accountCacheService 사용)
    const positions = await accountCacheService.getPositions()
    res.json(positions)
  } catch (error) {
    console.error('포지션 조회 오류:', error)
    res.status(500).json([])
  }
})

// 수동 매수 API
app.post('/api/trading/manual-buy', async (req, res) => {
  try {
    const {
      ticker,
      quantity,
      price,
      orderType, // 'market' or 'limit'
      currentPrice, // FMP 실시간 가격
      newsTitle,
      takeProfitPercent,
      stopLossPercent,
      isReservation, // 예약 주문 여부
      reservationPriceType // 'opening' or 'current'
    } = req.body

    if (!ticker || !quantity) {
      return res.status(400).json({ error: 'Ticker and quantity are required' })
    }

    // 현재 계정 타입 확인
    const accountType = tradingManager.getKISApi().getCurrentAccountType()
    const accountName = tradingManager.getKISApi().getCurrentAccount()?.ka_name || '알 수 없음'
    
    console.log(`\n📈 수동 매수 요청`)
    console.log(`   🔰 계정: [${accountType === 'REAL' ? '실전투자' : '모의투자'}] ${accountName}`)
    console.log(`   종목: ${ticker}`)
    console.log(`   수량: ${quantity}`)
    console.log(`   주문 타입: ${orderType}`)
    console.log(`   가격: $${price}`)
    console.log(`   현재가: $${currentPrice}`)
    console.log(`   예약 주문: ${isReservation ? 'YES' : 'NO'}`)

    // 예약 주문 (장 마감 시)
    if (isReservation) {
      const orderId = await savePendingOrder({
        po_ticker: ticker,
        po_account_type: accountType, // 계정 타입 추가
        po_order_type: 'buy',
        po_quantity: quantity,
        po_price_type: orderType,
        po_limit_price: orderType === 'limit' ? price : undefined,
        po_reservation_type: 'opening', // 시초가 즉시 체결
        po_take_profit_percent: takeProfitPercent,
        po_stop_loss_percent: stopLossPercent,
        po_reason: newsTitle || '수동 매수',
        po_news_title: newsTitle,
        po_status: 'pending'
      })

      return res.json({
        success: true,
        message: `${ticker} ${quantity}주 예약 주문 완료 (ID: ${orderId})`,
        orderId,
        isReservation: true
      })
    }

    // 즉시 주문 (장 오픈 시)
    const orderPrice = orderType === 'market' ? currentPrice : price

    try {
      // 모의투자: KIS API 기반으로 처리
      if (accountType === 'VIRTUAL') {
        console.log(`🔵 [모의투자] KIS API 기반 매수 처리 시작`)
        
        try {
          await tradingManager.getKISApi().buyStock(ticker, quantity, orderPrice)
          console.log(`✅ [모의투자] KIS API 매수 성공: ${ticker} x ${quantity}주`)
        } catch (buyError: any) {
          // 장 마감 OR 모의투자 미지원 → 자동 예약 주문 처리
          const isMarketClosed = buyError.message?.includes('장중이 아니거나') || 
                                 buyError.message?.includes('거래시간이 아닙니다') ||
                                 buyError.message?.includes('해당 시장은 거래 불가능한 시간입니다')
          
          const isVirtualUnsupported = buyError.message?.includes('모의투자에서는') || 
                                       buyError.message?.includes('해당업무가 제공되지')
          
          if (isMarketClosed || isVirtualUnsupported) {
            const reason = isMarketClosed ? '장 마감' : '모의투자 API 미지원'
            console.log(`⏰ [모의투자] ${reason} - 자동 예약 주문 처리`)
            
            // 예약 주문으로 저장
            const orderId = await savePendingOrder({
              po_account_type: 'VIRTUAL',
              po_ticker: ticker,
              po_order_type: 'buy',
              po_quantity: quantity,
              po_price_type: orderType, // 'market' or 'limit'
              po_limit_price: orderType === 'limit' ? price : null,
              po_reservation_type: 'opening', // 장 시작 시 실행
              po_take_profit_percent: takeProfitPercent,
              po_stop_loss_percent: stopLossPercent,
              po_reason: `${orderType === 'market' ? '시장가' : '지정가'} 매수 (${reason})`,
              po_news_title: newsTitle || '',
              po_status: 'pending'
            })
            
            return res.json({
              success: true,
              message: `${orderType === 'market' ? '시장가' : '지정가'} 매수 예약이 완료되었습니다. 장 시작 시 자동으로 실행됩니다.`,
              reservation: true,
              orderId
            })
          }
          
          // 그 외 에러는 그대로 던짐
          throw buyError
        }
        
        // 거래 이력 저장 (계정 타입 포함)
        await saveTradingRecord({
          t_ticker: ticker,
          t_account_type: 'VIRTUAL', // 계정 타입 추가
          t_type: 'BUY',
          t_quantity: quantity,
          t_price: orderPrice,
          t_total_amount: orderPrice * quantity,
          t_status: 'COMPLETED',
          t_reason: (newsTitle || '수동 매수')
        })
        
        return res.json({
          success: true,
          message: `${ticker} ${quantity}주 매수 완료 (모의투자)`,
          price: orderPrice,
          quantity,
          isReservation: false,
          virtual: true
        })
      }
      
      // 실전투자: KIS API 매수
      console.log(`🔴 [실전투자] KIS API 매수 처리 시작`)
      
      try {
        await tradingManager.getKISApi().buyStock(ticker, quantity, orderPrice)
        console.log(`✅ [실전투자] KIS API 매수 성공`)
      } catch (buyError: any) {
        // 장 마감 시 자동 예약 주문 처리
        if (buyError.message?.includes('장중이 아니거나') || 
            buyError.message?.includes('거래시간이 아닙니다') ||
            buyError.message?.includes('해당 시장은 거래 불가능한 시간입니다')) {
          console.log(`⏰ [실전투자] 장 마감 - 자동 예약 주문 처리`)
          
          // 예약 주문으로 저장
          const orderId = await savePendingOrder({
            po_account_type: 'REAL',
            po_ticker: ticker,
            po_order_type: 'buy',
            po_quantity: quantity,
            po_price_type: orderType, // 'market' or 'limit'
            po_limit_price: orderType === 'limit' ? price : null,
            po_reservation_type: 'opening', // 장 시작 시 실행
            po_take_profit_percent: takeProfitPercent,
            po_stop_loss_percent: stopLossPercent,
            po_reason: orderType === 'market' ? '시장가 매수 (장시작 시 실행)' : '지정가 매수 (장시작 시 실행)',
            po_news_title: newsTitle || '',
            po_status: 'pending'
          })
          
          return res.json({
            success: true,
            message: `${orderType === 'market' ? '시장가' : '지정가'} 매수 예약이 완료되었습니다. 장 시작 시 자동으로 실행됩니다.`,
            reservation: true,
            orderId
          })
        }
        throw buyError
      }

      // 익절/손절 설정만 DB에 저장 (실전투자)
      if ((takeProfitPercent && takeProfitPercent > 0) || (stopLossPercent && stopLossPercent > 0)) {
        try {
          await saveDBPosition({
            p_ticker: ticker,
            p_account_type: 'REAL', // 계정 타입 추가
            p_quantity: quantity,
            p_buy_price: orderPrice,
            p_current_price: currentPrice,
            p_profit_loss: 0,
            p_profit_loss_percent: 0,
            p_take_profit_enabled: takeProfitPercent ? true : false,
            p_take_profit_percent: takeProfitPercent,
            p_stop_loss_enabled: stopLossPercent ? true : false,
            p_stop_loss_percent: stopLossPercent
          })
          console.log(`💾 [실전투자] 익절/손절 설정 저장: ${ticker} (익절: ${takeProfitPercent}%, 손절: ${stopLossPercent}%)`)
        } catch (error: any) {
          if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR') {
            console.log(`⚠️ 익절/손절 테이블 없음 - DB 테이블 생성 필요 (${ticker})`)
    } else {
            throw error
          }
        }
      }

      // 거래 이력 저장 (계정 타입 포함)
      await saveTradingRecord({
        t_ticker: ticker,
        t_account_type: 'REAL', // 계정 타입 추가
        t_type: 'BUY',
        t_quantity: quantity,
        t_price: orderPrice,
        t_total_amount: orderPrice * quantity,
        t_status: 'COMPLETED',
        t_reason: newsTitle || '수동 매수'
      })

      return res.json({
        success: true,
        message: `${ticker} ${quantity}주 매수 완료`,
        price: orderPrice,
        quantity,
        isReservation: false
      })
    } catch (error: any) {
      console.error('매수 실패:', error)
      
      // 장 마감 에러인 경우 자동으로 예약 주문으로 전환
      const errorMsg = error.message || ''
      if (errorMsg.includes('장시작전') || errorMsg.includes('장마감') || errorMsg.includes('거래시간')) {
        console.log(`⏰ 장 마감 감지 → 예약 주문으로 자동 전환`)
        
        const orderId = await savePendingOrder({
          po_ticker: ticker,
          po_account_type: accountType, // 계정 타입 추가
          po_order_type: 'buy',
          po_quantity: quantity,
          po_price_type: orderType,
          po_limit_price: orderType === 'limit' ? price : undefined,
          po_reservation_type: reservationPriceType || 'opening',
          po_take_profit_percent: takeProfitPercent,
          po_stop_loss_percent: stopLossPercent,
          po_reason: newsTitle || '수동 매수 (장 마감 시 자동 예약)',
          po_news_title: newsTitle,
          po_status: 'pending'
        })

        return res.json({
          success: true,
          message: `장이 마감되어 예약 주문으로 전환되었습니다.\n${ticker} ${quantity}주 매수 예약 (ID: ${orderId})`,
          orderId,
          isReservation: true,
          autoConverted: true
        })
      }
      
      // 기타 에러
      res.status(500).json({
        success: false,
        error: error.message || 'Buy order failed'
      })
    }
  } catch (error: any) {
    console.error('매수 API 오류:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    })
  }
})

// 수동 매도 API
app.post('/api/trading/sell', async (req, res) => {
  try {
    const {
    ticker,
      quantity,
      price,
      orderType, // 'market' or 'limit'
      currentPrice, // FMP 실시간 가격
      newsTitle,
      isReservation // 예약 주문 여부
    } = req.body

    if (!ticker || !quantity) {
      return res.status(400).json({ error: 'Ticker and quantity are required' })
    }

    // 현재 계정 타입 확인
    const accountType = tradingManager.getKISApi().getCurrentAccountType()
    const accountName = tradingManager.getKISApi().getCurrentAccount()?.ka_name || '알 수 없음'
    
    console.log(`\n📉 수동 매도 요청`)
    console.log(`   🔰 계정: [${accountType === 'REAL' ? '실전투자' : '모의투자'}] ${accountName}`)
    console.log(`   종목: ${ticker}`)
    console.log(`   수량: ${quantity}`)
    console.log(`   주문 타입: ${orderType}`)
    console.log(`   가격: $${price}`)
    console.log(`   현재가: $${currentPrice}`)
    console.log(`   예약 주문: ${isReservation ? 'YES' : 'NO'}`)

    // 예약 주문 (장 마감 시)
    if (isReservation) {
      const orderId = await savePendingOrder({
        po_ticker: ticker,
        po_account_type: accountType, // 계정 타입 추가
        po_order_type: 'sell',
        po_quantity: quantity,
        po_price_type: orderType,
        po_limit_price: orderType === 'limit' ? price : undefined,
        po_reservation_type: 'opening', // 시초가 즉시 체결
        po_reason: newsTitle || '수동 매도',
        po_news_title: newsTitle,
        po_status: 'pending'
      })

      return res.json({
        success: true,
        message: `${ticker} ${quantity}주 예약 매도 주문 완료 (ID: ${orderId})`,
        orderId,
        isReservation: true
      })
    }

    // 즉시 주문 (장 오픈 시)
    const orderPrice = orderType === 'market' ? currentPrice : price

    try {
      // 모의투자: KIS API로 실제 보유 수량 확인 후 매도
      if (accountType === 'VIRTUAL') {
        console.log(`🔵 [모의투자] KIS API 기반 매도 처리 시작`)
        
        // 1. 보유 수량 확인 (캐시 우선, KIS API 폴백)
        let currentHolding = 0
        
        // 1-1. 캐시에서 먼저 확인 (빠르고 안정적)
        try {
          const positions = await accountCacheService.getPositions()
          const position = positions.find(p => p.ticker === ticker)
          if (position) {
            currentHolding = position.quantity
            console.log(`✓ [모의투자] ${ticker} 보유 수량: ${currentHolding}주 (캐시)`)
          }
        } catch (cacheError) {
          console.log(`⚠️ 캐시 조회 실패, KIS API 직접 조회 시도`)
        }
        
        // 1-2. 캐시에 없으면 KIS API 직접 조회
        if (currentHolding === 0) {
          try {
            const balance = await tradingManager.getKISApi().getBalance()
            console.log(`📊 [모의투자] KIS API 잔고 조회 성공`)
            
            // 🔍 디버깅: 전체 응답 구조 확인
            console.log(`🔍 output1 타입: ${typeof balance.output1}, 길이: ${balance.output1?.length || 0}`)
            if (balance.output1 && balance.output1.length > 0) {
              console.log(`🔍 첫 번째 항목 샘플:`, JSON.stringify(balance.output1[0], null, 2))
            }
            
            // output1: 해외주식 잔고 (각 종목별 보유 정보)
            if (balance.output1 && Array.isArray(balance.output1)) {
              console.log(`🔍 ${ticker} 검색 중... (총 ${balance.output1.length}개 종목)`)
              
              // 모든 종목 티커 출력
              const allTickers = balance.output1.map((item: any) => item.pdno || item.ticker || 'unknown')
              console.log(`🔍 보유 종목 티커: ${allTickers.join(', ')}`)
              
              const holding = balance.output1.find((item: any) => item.pdno === ticker)
              if (holding) {
                currentHolding = parseInt(holding.ord_psbl_qty || holding.hldg_qty || '0') // 주문가능수량 or 보유수량
                console.log(`✓ [모의투자] ${ticker} 보유 수량: ${currentHolding}주 (KIS API)`)
                console.log(`   상세:`, JSON.stringify(holding, null, 2))
  } else {
                console.log(`⚠️ [모의투자] ${ticker} 보유 내역 없음 (KIS API)`)
              }
            } else {
              console.log(`⚠️ output1이 배열이 아니거나 비어있음`)
            }
          } catch (balanceError: any) {
            console.warn(`⚠️ [모의투자] KIS 잔고 조회 실패: ${balanceError.message}`)
          }
        }
        
        // 2. 대기 중인 매도 주문 수량 확인
        const pendingOrders = await getPendingOrders(accountType)
        const pendingSellQuantity = pendingOrders
          .filter((order: any) => order.po_ticker === ticker && order.po_order_type === 'sell' && order.po_status === 'pending')
          .reduce((sum: number, order: any) => sum + order.po_quantity, 0)
        
        const availableToSell = currentHolding - pendingSellQuantity
        
        console.log(`📊 [모의투자] ${ticker} 수량 현황:`)
        console.log(`   전체 보유: ${currentHolding}주`)
        console.log(`   대기 중 매도: ${pendingSellQuantity}주`)
        console.log(`   실제 판매 가능: ${availableToSell}주`)
        console.log(`   요청 수량: ${quantity}주`)
        
        // 3. 수량 검증
        if (availableToSell < quantity) {
          throw new Error(`매도 가능한 수량이 부족합니다.\n\n전체 보유: ${currentHolding}주\n대기 중 매도: ${pendingSellQuantity}주\n판매 가능: ${availableToSell}주\n요청 수량: ${quantity}주`)
        }
        
        // 4. KIS API 매도 시도
        try {
          await tradingManager.getKISApi().sellStock(ticker, quantity, orderPrice)
          console.log(`✅ [모의투자] KIS API 매도 성공: ${ticker} x ${quantity}주`)
        } catch (sellError: any) {
          // 장 마감 OR 모의투자 미지원 → 자동 예약 주문 처리
          const isMarketClosed = sellError.message?.includes('장중이 아니거나') || 
                                 sellError.message?.includes('거래시간이 아닙니다') ||
                                 sellError.message?.includes('해당 시장은 거래 불가능한 시간입니다')
          
          const isVirtualUnsupported = sellError.message?.includes('모의투자에서는') || 
                                       sellError.message?.includes('해당업무가 제공되지')
          
          if (isMarketClosed || isVirtualUnsupported) {
            const reason = isMarketClosed ? '장 마감' : '모의투자 API 미지원'
            console.log(`⏰ [모의투자] ${reason} - 자동 예약 주문 처리`)
            
            // 예약 주문으로 저장
            await savePendingOrder({
              po_account_type: 'VIRTUAL',
              po_ticker: ticker,
              po_order_type: 'sell',
              po_quantity: quantity,
              po_price_type: orderType, // 'market' or 'limit'
              po_limit_price: orderType === 'limit' ? price : null,
              po_reservation_type: 'opening', // 장 시작 시 실행
              po_take_profit_percent: undefined,
              po_stop_loss_percent: undefined,
              po_reason: `${orderType === 'market' ? '시장가' : '지정가'} 매도 (${reason})`,
              po_news_title: '',
              po_status: 'pending'
            })
            
            return res.json({
              success: true,
              message: `${orderType === 'market' ? '시장가' : '지정가'} 매도 예약이 완료되었습니다. 장 시작 시 자동으로 실행됩니다.`,
              reservation: true
            })
          }
          
          // 그 외 에러는 그대로 던짐
          throw sellError
        }
        
        // 4. 거래 이력 저장
        await saveTradingRecord({
          t_ticker: ticker,
          t_account_type: 'VIRTUAL',
          t_type: 'SELL',
          t_quantity: quantity,
          t_price: orderPrice,
          t_total_amount: orderPrice * quantity,
          t_status: 'COMPLETED',
          t_reason: newsTitle || '수동 매도'
        })
        
        return res.json({
          success: true,
          message: `${ticker} ${quantity}주 매도 완료 (모의투자)`,
          price: orderPrice,
          quantity,
          isReservation: false,
          virtual: true
        })
  } else {
        // 실전투자: KIS API 매도
        console.log(`🔴 [실전투자] KIS API 매도 처리 시작`)
        
        // 1. 보유 수량 확인 (캐시 우선)
        let currentHolding = 0
        try {
          const positions = await accountCacheService.getPositions()
          const position = positions.find(p => p.ticker === ticker)
          if (position) {
            currentHolding = position.quantity
            console.log(`✓ [실전투자] ${ticker} 보유 수량: ${currentHolding}주 (캐시)`)
          }
        } catch (cacheError) {
          console.log(`⚠️ 캐시 조회 실패, KIS API 직접 조회 시도`)
          try {
            const balance = await tradingManager.getKISApi().getBalance()
            if (balance.output1 && Array.isArray(balance.output1)) {
              const holding = balance.output1.find((item: any) => item.pdno === ticker)
              if (holding) {
                currentHolding = parseInt(holding.ord_psbl_qty || holding.hldg_qty || '0')
                console.log(`✓ [실전투자] ${ticker} 보유 수량: ${currentHolding}주 (KIS API)`)
              }
            }
          } catch (balanceError: any) {
            console.warn(`⚠️ [실전투자] KIS 잔고 조회 실패: ${balanceError.message}`)
          }
        }
        
        // 2. 대기 중인 매도 주문 수량 확인
        const pendingOrders = await getPendingOrders(accountType)
        const pendingSellQuantity = pendingOrders
          .filter((order: any) => order.po_ticker === ticker && order.po_order_type === 'sell' && order.po_status === 'pending')
          .reduce((sum: number, order: any) => sum + order.po_quantity, 0)
        
        const availableToSell = currentHolding - pendingSellQuantity
        
        console.log(`📊 [실전투자] ${ticker} 수량 현황:`)
        console.log(`   전체 보유: ${currentHolding}주`)
        console.log(`   대기 중 매도: ${pendingSellQuantity}주`)
        console.log(`   실제 판매 가능: ${availableToSell}주`)
        console.log(`   요청 수량: ${quantity}주`)
        
        // 3. 수량 검증
        if (availableToSell < quantity) {
          throw new Error(`매도 가능한 수량이 부족합니다.\n\n전체 보유: ${currentHolding}주\n대기 중 매도: ${pendingSellQuantity}주\n판매 가능: ${availableToSell}주\n요청 수량: ${quantity}주`)
        }
        
        // 4. KIS API 매도 실행
        await tradingManager.getKISApi().sellStock(ticker, quantity, orderPrice)
      }

      // 실전투자 매도 성공 후 처리
      console.log(`✅ [실전투자] KIS API 매도 성공`)
      
      // 익절/손절 설정 삭제 (실전투자)
      try {
        const { deleteDBPosition } = await import('./db.js')
        await deleteDBPosition(ticker, 'REAL') // 계정 타입 전달
        console.log(`🗑️ [실전투자] 익절/손절 설정 삭제: ${ticker}`)
      } catch (error: any) {
        if (error.code !== 'ER_NO_SUCH_TABLE' && error.code !== 'ER_BAD_FIELD_ERROR') {
          console.error(`⚠️ 익절/손절 설정 삭제 실패: ${ticker}`, error.message)
        }
      }

      // 거래 이력 저장 (계정 타입 포함)
      await saveTradingRecord({
        t_ticker: ticker,
        t_account_type: 'REAL', // 계정 타입 추가
        t_type: 'SELL',
        t_quantity: quantity,
        t_price: orderPrice,
        t_total_amount: orderPrice * quantity,
        t_status: 'COMPLETED',
        t_reason: newsTitle || '수동 매도'
      })

      return res.json({
        success: true,
        message: `${ticker} ${quantity}주 매도 완료`,
        price: orderPrice,
        quantity,
        isReservation: false
      })
    } catch (error: any) {
      console.error('매도 실패:', error)
      
      // 장 마감 에러인 경우 자동으로 예약 주문으로 전환 (실전투자만)
      const errorMsg = error.message || ''
      if (accountType === 'REAL' && (errorMsg.includes('장시작전') || errorMsg.includes('장마감') || errorMsg.includes('거래시간'))) {
        console.log(`⏰ [실전투자] 장 마감 감지 → 예약 주문으로 자동 전환`)
        
        const orderId = await savePendingOrder({
          po_ticker: ticker,
          po_account_type: accountType, // 계정 타입 추가
          po_order_type: 'sell',
          po_quantity: quantity,
          po_price_type: orderType,
          po_limit_price: orderType === 'limit' ? price : undefined,
          po_reservation_type: 'opening',
          po_reason: newsTitle || '수동 매도 (장 마감 시 자동 예약)',
          po_news_title: newsTitle,
          po_status: 'pending'
        })

        return res.json({
          success: true,
          message: `장이 마감되어 예약 주문으로 전환되었습니다.\n${ticker} ${quantity}주 매도 예약 (ID: ${orderId})`,
          orderId,
          isReservation: true,
          autoConverted: true
        })
      }
      
      // 기타 에러
      res.status(500).json({
        success: false,
        error: error.message || 'Sell order failed'
      })
    }
  } catch (error: any) {
    console.error('매도 API 오류:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    })
  }
})

// 예약 주문 조회 API
app.get('/api/trading/pending-orders', async (req, res) => {
  try {
    const currentAccount = kisApiManager.getCurrentAccount()
    const accountType = currentAccount?.ka_type
    
    console.log(`⏰ 예약 주문 조회 요청 (${accountType})`)
    const orders = await getPendingOrders(accountType)
    res.json(orders)
  } catch (error) {
    console.error('예약 주문 조회 오류:', error)
    res.status(500).json({ error: 'Failed to fetch pending orders' })
  }
})

// 예약 주문 취소 API
app.delete('/api/trading/pending-orders/:orderId', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId)
    const currentAccount = kisApiManager.getCurrentAccount()
    const accountType = currentAccount?.ka_type
    
    console.log(`❌ 예약 주문 취소 요청 (ID: ${orderId}, 계정: ${accountType})`)
    
    // DB에서 해당 주문 확인
    const orders = await getPendingOrders(accountType)
    const order = orders.find((o: any) => o.po_id === orderId)
    
    if (!order) {
      return res.status(404).json({ error: `예약 주문(ID: ${orderId})을 찾을 수 없습니다.` })
    }
    
    // 계정 타입 검증
    if (order.po_account_type !== accountType) {
      return res.status(403).json({ error: '다른 계정의 주문은 취소할 수 없습니다.' })
    }
    
    // 주문 취소 (상태를 'cancelled'로 변경)
    await updatePendingOrderStatus(orderId, 'cancelled')
    console.log(`✅ 예약 주문 취소 완료: ${order.po_ticker} ${order.po_order_type.toUpperCase()} ${order.po_quantity}주`)
    
    res.json({ 
      success: true, 
      message: `${order.po_ticker} ${order.po_order_type === 'buy' ? '매수' : '매도'} 예약이 취소되었습니다.`
    })
  } catch (error: any) {
    console.error('예약 주문 취소 오류:', error)
    res.status(500).json({ error: error.message || 'Failed to cancel pending order' })
  }
})

// 미체결 내역 조회 (KIS API) - 현재 미구현
// app.get('/api/trading/unexecuted-orders', async (req, res) => {
//   try {
//     console.log('\n📋 [API] 미체결 내역 조회 요청')
//     const result = await tradingManager.getKISApi().getUnexecutedOrders()
//     
//     if (result.rt_cd === '0') {
//       res.json({ 
//         success: true, 
//         orders: result.output || []
//       })
//     } else {
//       res.json({ 
//         success: false, 
//         message: result.msg1,
//         orders: [] 
//       })
//     }
//   } catch (error: any) {
//     console.error('미체결 내역 조회 실패:', error)
//     res.status(500).json({ 
//       success: false,
//       error: error.message,
//       orders: [] 
//     })
//   }
// })

// 주문체결 내역 조회 (KIS API) - 현재 미구현
// app.get('/api/trading/order-history', async (req, res) => {
//   try {
//     const days = parseInt(req.query.days as string) || 7
//     console.log(`\n📜 [API] 주문체결 내역 조회 요청 (최근 ${days}일)`)
//     const result = await tradingManager.getKISApi().getOrderHistory(days)
//     
//     if (result.rt_cd === '0') {
//       res.json({ 
//         success: true, 
//         orders: result.output || []
//       })
//     } else {
//       res.json({ 
//         success: false, 
//         message: result.msg1,
//         orders: [] 
//       })
//     }
//   } catch (error: any) {
//     console.error('주문체결 내역 조회 실패:', error)
//     res.status(500).json({ 
//       success: false,
//       error: error.message,
//       orders: [] 
//     })
//   }
// })

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

const PORT = 3001
httpServer.listen(PORT, async () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
  
  // 캐시 정리 스케줄러 (매일 새벽 3시)
  const scheduleCleanup = () => {
    const now = new Date()
    const next3AM = new Date(now)
    next3AM.setHours(3, 0, 0, 0)
    
    if (next3AM <= now) {
      next3AM.setDate(next3AM.getDate() + 1)
    }
    
    const timeUntilCleanup = next3AM.getTime() - now.getTime()
    
    setTimeout(() => {
      chartCacheService.cleanOldCache()
      scheduleCleanup() // 다음 정리 예약
    }, timeUntilCleanup)
    
    console.log(`🧹 캐시 정리 예약: ${next3AM.toLocaleString('ko-KR')}`)
  }
  
  scheduleCleanup()
  
  // 서버 시작 후 KIS API 초기화
  await initializeServices()
  
  // 주문 감시 서비스 초기화 및 시작
  orderMonitor = new OrderMonitor(tradingManager.getKISApi(), fmpApi)
  orderMonitor.start()
  
  // 자동 매수 서비스 시작
  autoTradingService.start()
  
  console.log('✅ 서버 초기화 완료')
  
  // 뉴스 DB 감시 시작
  startNewsWatcher()
})

// ==================== 계정 관리 API ====================

import { kisApiManager } from './kis-api-manager.js'
import { getAllAccounts, getAccountsByType, setDefaultAccount as setDefaultAccountDB, addAccount, pool } from './db.js'

// 현재 계정 정보 조회 (반드시 /api/accounts/:type 보다 먼저 정의)
app.get('/api/accounts/current', async (req, res) => {
  try {
    const currentAccount = kisApiManager.getCurrentAccount()
    if (!currentAccount) {
      return res.status(404).json({ error: 'No account selected' })
    }
    
    res.json({
      ka_id: currentAccount.ka_id,
      ka_type: currentAccount.ka_type,
      ka_name: currentAccount.ka_name,
      ka_account_no: currentAccount.ka_account_no.substring(0, 4) + '****' + currentAccount.ka_account_no.substring(8)
    })
  } catch (error) {
    console.error('현재 계정 조회 오류:', error)
    res.status(500).json({ error: 'Failed to fetch current account' })
  }
})

// 모든 계정 조회
app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await getAllAccounts()
    // 민감한 정보 제거
    const safeAccounts = accounts.map(acc => ({
      ka_id: acc.ka_id,
      ka_type: acc.ka_type,
      ka_name: acc.ka_name,
      ka_account_no: acc.ka_account_no.substring(0, 4) + '****' + acc.ka_account_no.substring(8), // 마스킹
      ka_is_active: acc.ka_is_active,
      ka_is_default: acc.ka_is_default
    }))
    res.json({ accounts: safeAccounts })
  } catch (error) {
    console.error('계정 조회 오류:', error)
    res.status(500).json({ error: 'Failed to fetch accounts' })
  }
})

// 특정 타입의 계정 조회
app.get('/api/accounts/:type', async (req, res) => {
  try {
    const type = req.params.type.toUpperCase() as 'REAL' | 'VIRTUAL'
    if (type !== 'REAL' && type !== 'VIRTUAL') {
      return res.status(400).json({ error: 'Invalid account type' })
    }
    
    const accounts = await getAccountsByType(type)
    const safeAccounts = accounts.map(acc => ({
      ka_id: acc.ka_id,
      ka_type: acc.ka_type,
      ka_name: acc.ka_name,
      ka_account_no: acc.ka_account_no.substring(0, 4) + '****' + acc.ka_account_no.substring(8),
      ka_is_active: acc.ka_is_active,
      ka_is_default: acc.ka_is_default
    }))
    res.json({ accounts: safeAccounts })
  } catch (error) {
    console.error('계정 조회 오류:', error)
    res.status(500).json({ error: 'Failed to fetch accounts' })
  }
})

// 계정 타입 전환 (실전/모의)
app.post('/api/accounts/switch-type', async (req, res) => {
  try {
    const { type } = req.body
    if (type !== 'REAL' && type !== 'VIRTUAL') {
      return res.status(400).json({ error: 'Invalid account type' })
    }
    
    await kisApiManager.switchAccountType(type)
    const currentAccount = kisApiManager.getCurrentAccount()
    
    // 캐시 무효화 (계좌 전환)
    if (currentAccount) {
      accountCacheService.onAccountSwitch(currentAccount.ka_type, currentAccount.ka_account_no)
    }
    
    // WebSocket 재연결 (계좌 타입에 따라 다른 URL 사용)
    if (kisWebSocketService.getConnectionStatus()) {
      kisWebSocketService.disconnect()
      console.log(`🔄 계정 전환: WebSocket 재연결 중... (${type})`)
      await kisWebSocketService.connect()
    }
    
    res.json({
      success: true,
      message: `${type === 'REAL' ? '실전투자' : '모의투자'}로 전환되었습니다`,
      currentAccount: currentAccount ? {
        ka_id: currentAccount.ka_id,
        ka_type: currentAccount.ka_type,
        ka_name: currentAccount.ka_name
      } : null
    })
  } catch (error) {
    console.error('계정 타입 전환 오류:', error)
    res.status(500).json({ error: 'Failed to switch account type' })
  }
})

// 특정 계정으로 전환
app.post('/api/accounts/switch', async (req, res) => {
  try {
    const { accountId } = req.body
    if (!accountId) {
      return res.status(400).json({ error: 'Account ID is required' })
    }
    
    await kisApiManager.switchAccount(accountId)
    const currentAccount = kisApiManager.getCurrentAccount()
    
    // 캐시 무효화 (계좌 전환)
    if (currentAccount) {
      accountCacheService.onAccountSwitch(currentAccount.ka_type, currentAccount.ka_account_no)
    }
    
    // WebSocket 재연결 (계좌 타입에 따라 다른 URL 사용)
    if (kisWebSocketService.getConnectionStatus()) {
      kisWebSocketService.disconnect()
      console.log(`🔄 계정 전환: WebSocket 재연결 중... (${currentAccount?.ka_type})`)
      await kisWebSocketService.connect()
  }
  
  res.json({
      success: true,
      message: `${currentAccount?.ka_name}(으)로 전환되었습니다`,
      currentAccount: currentAccount ? {
        ka_id: currentAccount.ka_id,
        ka_type: currentAccount.ka_type,
        ka_name: currentAccount.ka_name
      } : null
    })
  } catch (error) {
    console.error('계정 전환 오류:', error)
    res.status(500).json({ error: 'Failed to switch account' })
  }
})

// 기본 계정 설정
app.post('/api/accounts/set-default', async (req, res) => {
  try {
    const { accountId } = req.body
    if (!accountId) {
      return res.status(400).json({ error: 'Account ID is required' })
    }
    
    await setDefaultAccountDB(accountId)
    res.json({ success: true, message: '기본 계정이 설정되었습니다' })
  } catch (error) {
    console.error('기본 계정 설정 오류:', error)
    res.status(500).json({ error: 'Failed to set default account' })
  }
})

// 계정 추가
app.post('/api/accounts/add', async (req, res) => {
  try {
    const { ka_type, ka_name, ka_account_no, ka_account_password, ka_app_key, ka_app_secret } = req.body
    
    if (!ka_type || !ka_name || !ka_account_no || !ka_account_password || !ka_app_key || !ka_app_secret) {
      return res.status(400).json({ error: 'All fields are required' })
    }
    
    if (ka_type !== 'REAL' && ka_type !== 'VIRTUAL') {
      return res.status(400).json({ error: 'Invalid account type' })
    }
    
    const accountId = await addAccount({
      ka_type,
      ka_name,
      ka_account_no,
      ka_account_password,
      ka_app_key,
      ka_app_secret,
      ka_is_active: true,
      ka_is_default: false
    })
    
    res.json({ success: true, message: '계정이 추가되었습니다', accountId })
  } catch (error) {
    console.error('계정 추가 오류:', error)
    res.status(500).json({ error: 'Failed to add account' })
  }
})

// ==================== 종목 정보 API ====================

// 종목 한국어 이름 조회
app.get('/api/stocks/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params
    const [rows] = await pool.query(
      `SELECT s_ticker, s_name_kr, s_name FROM _STOCKS WHERE s_ticker = ?`,
      [ticker]
    )
    const stock = (rows as any[])[0]
    if (stock) {
      res.json(stock)
    } else {
      // 데이터 없으면 빈 값 반환 (404 대신)
      res.json({ s_ticker: ticker, s_name_kr: '', s_name: '' })
    }
  } catch (error) {
    // 테이블이 없거나 오류 발생 시 빈 값 반환 (500 에러 대신)
    // console.error('종목 정보 조회 오류:', error) // 로그 제거
    res.json({ s_ticker: req.params.ticker, s_name_kr: '', s_name: '' })
  }
})

// ==================== 자동 매수 서비스 API ====================

// 자동 매수 상태 조회
app.get('/api/auto-trading/status', (req, res) => {
  try {
    const status = autoTradingService.getStatus()
    res.json(status)
  } catch (error) {
    console.error('자동 매수 상태 조회 오류:', error)
    res.status(500).json({ error: 'Failed to get auto-trading status' })
  }
})

// 자동 매수 시작
app.post('/api/auto-trading/start', (req, res) => {
  try {
    autoTradingService.start()
    res.json({ success: true, message: '자동 매수 서비스가 시작되었습니다' })
  } catch (error) {
    console.error('자동 매수 시작 오류:', error)
    res.status(500).json({ error: 'Failed to start auto-trading' })
  }
})

// 자동 매수 중지
app.post('/api/auto-trading/stop', (req, res) => {
  try {
    autoTradingService.stop()
    res.json({ success: true, message: '자동 매수 서비스가 중지되었습니다' })
  } catch (error) {
    console.error('자동 매수 중지 오류:', error)
    res.status(500).json({ error: 'Failed to stop auto-trading' })
  }
})

// 자동 매수 ON/OFF 토글
app.post('/api/auto-trading/toggle', async (req, res) => {
  try {
    const { enabled } = req.body
    const accountType = kisApiManager.getCurrentAccountType()
    
    // DB에 설정 저장
    await toggleAutoTrading(accountType, enabled)
    
    if (enabled) {
      autoTradingService.start()
    } else {
      autoTradingService.stop()
    }
    res.json({ success: true, enabled })
  } catch (error) {
    console.error('자동 매수 토글 오류:', error)
    res.status(500).json({ error: 'Failed to toggle auto-trading' })
  }
})

// 자동 매수 설정 조회
app.get('/api/auto-trading/config', async (req, res) => {
  try {
    const accountType = kisApiManager.getCurrentAccountType()
    const dbConfig = await getAutoTradingConfig(accountType)
    
    if (dbConfig) {
      res.json({
        enabled: dbConfig.atc_enabled,
        bullishThreshold: dbConfig.atc_bullish_threshold,
        immediateImpactThreshold: dbConfig.atc_immediate_impact_threshold,
        takeProfitPercent: dbConfig.atc_take_profit_percent,
        stopLossPercent: dbConfig.atc_stop_loss_percent,
        maxInvestmentPerTrade: dbConfig.atc_max_investment_per_trade,
        maxDailyTrades: dbConfig.atc_max_daily_trades
      })
    } else {
      // 기본값 반환
      res.json({
        enabled: false,
        bullishThreshold: 70,
        immediateImpactThreshold: 70,
        takeProfitPercent: 5.0,
        stopLossPercent: 3.0,
        maxInvestmentPerTrade: 100.0,
        maxDailyTrades: 10
      })
    }
  } catch (error) {
    console.error('자동 매수 설정 조회 오류:', error)
    res.status(500).json({ error: 'Failed to get auto-trading config' })
  }
})

// 자동 매수 설정 저장
app.post('/api/auto-trading/config', async (req, res) => {
  try {
    const config = req.body
    const accountType = kisApiManager.getCurrentAccountType()
    
    // DB에 저장
    const success = await saveAutoTradingConfig({
      atc_account_type: accountType,
      atc_enabled: config.enabled,
      atc_bullish_threshold: config.bullishThreshold,
      atc_immediate_impact_threshold: config.immediateImpactThreshold,
      atc_take_profit_percent: config.takeProfitPercent,
      atc_stop_loss_percent: config.stopLossPercent,
      atc_max_investment_per_trade: config.maxInvestmentPerTrade,
      atc_max_daily_trades: config.maxDailyTrades
    })
    
    if (success) {
      // 자동매수 서비스에도 설정 반영
      autoTradingService.setConfig(config)
      res.json({ success: true, message: '설정이 저장되었습니다' })
    } else {
      res.status(500).json({ error: 'Failed to save config to database' })
    }
  } catch (error) {
    console.error('자동 매수 설정 저장 오류:', error)
    res.status(500).json({ error: 'Failed to save auto-trading config' })
  }
})

// 감지된 뉴스 조회
app.get('/api/auto-trading/detected-news', async (req, res) => {
  try {
    const detectedNews = await autoTradingService.getDetectedNews()
    res.json(detectedNews)
  } catch (error) {
    console.error('감지된 뉴스 조회 오류:', error)
    res.status(500).json({ error: 'Failed to get detected news' })
  }
})

// 수동 즉시 매수
app.post('/api/auto-trading/manual-buy', async (req, res) => {
  try {
    const { ticker, newsTitle, bullishScore, impactScore } = req.body
    const result = await autoTradingService.manualBuy(ticker, newsTitle, bullishScore, impactScore)
    res.json(result)
  } catch (error: any) {
    console.error('수동 매수 오류:', error)
    res.status(500).json({ error: error.message || 'Failed to execute manual buy' })
  }
})
