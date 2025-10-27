import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { TradingManager } from './trading-manager.js'
import { FMPApi } from './fmp-api.js'
import { LocalSymbolMatcher } from './local-symbol-matcher.js'
import { getTradingHistory, saveTradingRecord, TradingRecord, getNewsPaginated, NewsFromDB, watchNewsDB, savePendingOrder, getPendingOrders, saveDBPosition, updatePendingOrderStatus } from './db.js'
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
    
    // 1. KIS API로 실시간 시세 조회 시도
    try {
      const kisQuote = await tradingManager.getKISApi().getOverseasQuote(symbol, 'NASD')
      if (kisQuote && kisQuote.price) {
        console.log(`💵 KIS 실시간 가격: ${symbol} = $${kisQuote.price}`)
        return res.json(kisQuote)
      }
    } catch (kisError) {
      console.log(`⚠️ KIS API 실패, FMP로 폴백: ${symbol}`)
    }
    
    // 2. FMP API로 폴백
    const quote = await fmpRealTimeApi.getQuote(symbol)
    console.log(`💵 FMP 가격: ${symbol} = $${quote?.price || 'N/A'}`)
    
    res.json(quote)
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
    const page = parseInt(req.query.page as string) || 1
    const pageSize = parseInt(req.query.pageSize as string) || 30
    
    const result = await getNewsPaginated(page, pageSize)
    
    // NewsFromDB를 프론트엔드 형식으로 변환
    const formattedNews = result.news.map((dbNews: NewsFromDB) => ({
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
    
    res.json({
      news: formattedNews,
      page,
      pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pageSize)
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
          // 장 마감 시 자동 예약 주문 처리
          if (buyError.message?.includes('장중이 아니거나') || 
              buyError.message?.includes('거래시간이 아닙니다') ||
              buyError.message?.includes('해당 시장은 거래 불가능한 시간입니다')) {
            console.log(`⏰ [모의투자] 장 마감 - 자동 예약 주문 처리`)
            
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
        
        // 1. KIS API로 실제 보유 수량 확인
        let currentHolding = 0
        try {
          const balance = await tradingManager.getKISApi().getBalance()
          console.log(`📊 [모의투자] KIS API 잔고 조회 성공`)
          
          // output1: 해외주식 잔고 (각 종목별 보유 정보)
          if (balance.output1 && Array.isArray(balance.output1)) {
            const holding = balance.output1.find((item: any) => item.pdno === ticker)
            if (holding) {
              currentHolding = parseInt(holding.ord_psbl_qty || holding.hldg_qty || '0') // 주문가능수량 or 보유수량
              console.log(`✓ [모의투자] ${ticker} 보유 수량: ${currentHolding}주 (KIS API)`)
            } else {
              console.log(`⚠️ [모의투자] ${ticker} 보유 내역 없음 (KIS API)`)
            }
          }
        } catch (balanceError: any) {
          console.warn(`⚠️ [모의투자] KIS 잔고 조회 실패: ${balanceError.message}`)
        }
        
        console.log(`📊 [모의투자] ${ticker} 최종 보유 수량: ${currentHolding}, 매도 요청: ${quantity}`)
        
        // 2. 수량 검증
        if (currentHolding < quantity) {
          throw new Error(`[모의투자] 매도 가능한 수량이 부족합니다 (보유: ${currentHolding}, 요청: ${quantity})`)
        }
        
        // 3. KIS API 매도 시도
        try {
          await tradingManager.getKISApi().sellStock(ticker, quantity, orderPrice)
          console.log(`✅ [모의투자] KIS API 매도 성공: ${ticker} x ${quantity}주`)
        } catch (sellError: any) {
          // 장 마감 시 자동 예약 주문 처리
          if (sellError.message?.includes('장중이 아니거나') || 
              sellError.message?.includes('거래시간이 아닙니다') ||
              sellError.message?.includes('해당 시장은 거래 불가능한 시간입니다')) {
            console.log(`⏰ [모의투자] 장 마감 - 자동 예약 주문 처리`)
            
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
              po_reason: orderType === 'market' ? '시장가 매도 (장시작 시 실행)' : '지정가 매도 (장시작 시 실행)',
              po_news_title: '',
              po_status: 'pending'
            })
            
            return res.json({
              success: true,
              message: `${orderType === 'market' ? '시장가' : '지정가'} 매도 예약이 완료되었습니다. 장 시작 시 자동으로 실행됩니다.`,
              reservation: true
            })
          }
          
          // 모의투자 미지원 에러
          if (sellError.message?.includes('모의투자에서는') || sellError.message?.includes('해당업무가 제공되지')) {
            console.log(`⚠️ [모의투자] KIS API 매도 미지원 - 수동 처리`)
            throw new Error('[모의투자] KIS API가 매도를 지원하지 않습니다. 실제 KIS 모의투자 웹/앱에서 매도해주세요.')
          }
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
import { getAllAccounts, getAccountsByType, setDefaultAccount as setDefaultAccountDB, addAccount } from './db.js'

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
