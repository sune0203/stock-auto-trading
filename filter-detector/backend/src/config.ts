// 환경 설정 관리
export const config = {
  // 데이터베이스 설정
  db: {
    host: process.env.DB_HOST || '116.122.37.82',
    user: process.env.DB_USER || 'nasdaq',
    password: process.env.DB_PASS || 'core1601!',
    database: process.env.DB_NAME || 'nasdaq',
    port: parseInt(process.env.DB_PORT || '3306'),
  },

  // FMP API 설정
  fmp: {
    apiKey: process.env.FMP_API_KEY || 'Nz122fIiH3KWDx8UVBdQFL8a5NU9lRhc',
    baseUrl: 'https://financialmodelingprep.com/api/v3',
    stableUrl: 'https://financialmodelingprep.com/stable',
  },

  // Gemini API 설정
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || 'AIzaSyBqPO88i4sntDCbRqb1XZ02Sn3PG-EYhLs',
    model: 'gemini-2.0-flash-exp',
  },

  // 서버 설정
  server: {
    port: parseInt(process.env.PORT || '3005'),
    wsPort: parseInt(process.env.WS_PORT || '3006'),
  },

  // 감지 설정
  scanner: {
    scanIntervalMinutes: parseInt(process.env.SCAN_INTERVAL_MINUTES || '1'),  // 1분마다 자동 스캔
    priceTrackIntervalSeconds: parseInt(process.env.PRICE_TRACK_INTERVAL_SECONDS || '10'),  // 10초마다 가격 추적
    eventLookbackDays: parseInt(process.env.EVENT_LOOKBACK_DAYS || '2'),
    
    // 점수 계산 가중치
    weights: {
      volumeRatio: 25,      // 거래량 비율
      bbSqueeze: 15,        // 볼린저밴드 스퀴즈
      priceStability: 10,   // 가격 안정성
      goldenCross: 10,      // 골든크로스
      lowFloat: 5,          // 낮은 유통량
      secEvent: 20,         // SEC 이벤트
    },
    
    // 임계값 설정
    thresholds: {
      minScore: 50,              // 최소 감지 점수
      volumeRatioMin: 1.5,       // 최소 거래량 비율
      maxFloatShares: 20000000,  // 최대 유통 주식 수
      priceChangeMax: 0.03,      // 최대 가격 변동률 (보합)
    },
  },

  // SEC 설정
  sec: {
    userAgent: process.env.SEC_USER_AGENT || 'nasdaq-detector@example.com',
    rateLimit: parseFloat(process.env.EDGAR_RATE_LIMIT || '0.2'),
    targetForms: ['8-K', '424B5', 'S-1', 'S-3', 'F-3', '424B2', '424B3'],
  },
};

