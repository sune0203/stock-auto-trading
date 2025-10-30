import express, { Request, Response } from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { config } from './config';
import { 
  initDatabase, 
  getRecentDetections, 
  getActiveDetections,
  getPriceHistory,
  stopTracking,
  getScannerConfig,
  updateScannerConfig,
} from './database';
import { surgeScanner } from './surge-scanner';
import { priceTracker } from './price-tracker';
import { wsServer } from './websocket-server';
import { fmpClient } from './fmp-client';

// Express 앱 생성
const app = express();
const port = config.server.port;

// 미들웨어
app.use(cors());
app.use(express.json());

// 로깅 미들웨어
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// ============================================
// API 엔드포인트
// ============================================

// 헬스 체크
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    services: {
      scanner: surgeScanner.getStatus(),
      priceTracker: priceTracker.getStatus(),
      websocket: {
        clients: wsServer.getClientCount(),
      },
    },
  });
});

// 감지 목록 조회
app.get('/api/detections', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const detections = await getRecentDetections(limit, offset);
    
    res.json({
      success: true,
      data: detections,
      count: detections.length,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 추적 중인 감지 목록
app.get('/api/detections/active', async (req: Request, res: Response) => {
  try {
    const detections = await getActiveDetections();
    
    res.json({
      success: true,
      data: detections,
      count: detections.length,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 특정 감지의 가격 히스토리
app.get('/api/detections/:id/history', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const history = await getPriceHistory(id);
    
    res.json({
      success: true,
      data: history,
      count: history.length,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 추적 중지
app.post('/api/detections/:id/stop', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await stopTracking(id);
    
    res.json({
      success: true,
      message: `감지 ID ${id} 추적 중지`,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 수동 스캔 실행
app.post('/api/scan/manual', async (req: Request, res: Response) => {
  try {
    const { symbols, scanType } = req.body;

    let detections;

    if (scanType === 'pennystock') {
      // 나스닥 동전주 스캔
      const maxPrice = req.body.maxPrice || 5;
      detections = await surgeScanner.scanNasdaqPennyStocks(maxPrice);
    } else if (scanType === 'active') {
      // 활성 거래 종목 스캔
      const minVolume = req.body.minVolume || 100000;
      detections = await surgeScanner.scanActiveStocks(minVolume);
    } else if (scanType === 'gainers') {
      // 최대 상승 종목 스캔 (Biggest Gainers)
      detections = await surgeScanner.scanBiggestGainers();
    } else if (scanType === 'most-actives') {
      // 최대 거래량 종목 스캔 (Most Actives)
      detections = await surgeScanner.scanMostActives();
    } else if (symbols && Array.isArray(symbols)) {
      // 커스텀 심볼 리스트 스캔
      detections = await surgeScanner.scanCustomSymbols(symbols);
    } else {
      return res.status(400).json({
        success: false,
        error: '스캔 타입 또는 심볼 리스트를 지정해주세요.',
      });
    }

    // WebSocket으로 결과 전송
    detections.forEach(detection => {
      wsServer.notifyDetection(detection);
    });

    wsServer.notifyScanComplete({
      detectionCount: detections.length,
      totalScanned: symbols?.length || 0,
      scanTime: new Date(),
    });

    res.json({
      success: true,
      data: detections,
      count: detections.length,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 단일 종목 분석
app.post('/api/scan/symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: '심볼을 지정해주세요.',
      });
    }

    const detection = await surgeScanner.analyzeStock(symbol);

    if (detection) {
      wsServer.notifyDetection(detection);
    }

    res.json({
      success: true,
      data: detection,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 스캐너 설정 조회
app.get('/api/scanner/config', async (req: Request, res: Response) => {
  try {
    const scannerConfig = await getScannerConfig();
    
    res.json({
      success: true,
      data: scannerConfig,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 스캐너 설정 업데이트
app.put('/api/scanner/config', async (req: Request, res: Response) => {
  try {
    const { isActive, minScore, scanInterval } = req.body;
    
    await updateScannerConfig({
      isActive,
      minScore,
      scanInterval,
    });

    res.json({
      success: true,
      message: '스캐너 설정이 업데이트되었습니다.',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 현재 시장 상태
app.get('/api/market/status', (req: Request, res: Response) => {
  const session = fmpClient.getMarketSession();
  const isOpen = fmpClient.isMarketOpen();

  res.json({
    success: true,
    data: {
      session,
      isOpen,
      timestamp: new Date(),
    },
  });
});

// 실시간 가격 조회
app.get('/api/price/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const price = await priceTracker.getPriceNow(symbol);

    if (!price) {
      return res.status(404).json({
        success: false,
        error: '가격 정보를 찾을 수 없습니다.',
      });
    }

    res.json({
      success: true,
      data: price,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 가격 변동률 조회
app.get('/api/price-change/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const priceChange = await fmpClient.getPriceChange(symbol);

    if (!priceChange) {
      return res.status(404).json({
        success: false,
        error: '가격 변동률 정보를 찾을 수 없습니다.',
      });
    }

    res.json({
      success: true,
      data: priceChange,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 배치 가격 변동률 조회
app.post('/api/price-change/batch', async (req: Request, res: Response) => {
  try {
    const { symbols } = req.body;

    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({
        success: false,
        error: '심볼 배열을 제공해주세요.',
      });
    }

    const priceChanges = await fmpClient.getBatchPriceChange(symbols);

    // Map을 객체로 변환
    const result: any = {};
    priceChanges.forEach((value, key) => {
      result[key] = value;
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// 서버 시작
// ============================================

async function startServer() {
  try {
    console.log('🚀 급등주 감지 시스템 시작...\n');

    // 데이터베이스 초기화
    await initDatabase();

    // WebSocket 서버 시작
    wsServer.start();

    // 가격 추적 시작
    priceTracker.start((update) => {
      wsServer.notifyPriceUpdate(update);
    });

    // Express 서버 시작
    app.listen(port, () => {
      console.log(`\n✅ API 서버 시작: http://localhost:${port}`);
      console.log(`\n📊 시스템 준비 완료!\n`);
    });

    // 정기 스캔 스케줄 (옵션)
    // 매 5분마다 활성 거래 종목 스캔
    cron.schedule('*/5 * * * *', async () => {
      console.log('\n⏰ 정기 스캔 시작...');
      
      const config = await getScannerConfig();
      
      if (config && config.isActive) {
        const detections = await surgeScanner.scanActiveStocks(100000);
        
        detections.forEach(detection => {
          wsServer.notifyDetection(detection);
        });

        wsServer.notifyScanComplete({
          detectionCount: detections.length,
          totalScanned: 0,
          scanTime: new Date(),
        });
      }
    });

  } catch (error) {
    console.error('❌ 서버 시작 실패:', error);
    process.exit(1);
  }
}

// Graceful Shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 서버 종료 중...');
  
  priceTracker.stop();
  wsServer.stop();
  
  process.exit(0);
});

// 서버 시작
startServer();

