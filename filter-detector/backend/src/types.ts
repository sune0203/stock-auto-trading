// 시장 세션 타입
export type MarketSession = 'premarket' | 'regular' | 'aftermarket' | 'closed';

// 주식 기본 정보
export interface StockInfo {
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  volume: number;
  marketCap?: number;
  float?: number;
  changePercent?: number;  // 변동률 (%)
}

// 가격 데이터
export interface PriceData {
  symbol: string;
  timestamp: Date;
  session: MarketSession;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// SEC 공시 정보
export interface SecFiling {
  symbol: string;
  type: string;
  filingDate: Date;
  url?: string;
  analysis?: {       // Gemini 분석 결과
    summary: string;
    upProbability: number;
    positiveScore: number;
    negativeScore: number;
    keyPoints: string[];
    recommendation: string;
  };
}

// 기술적 지표
export interface TechnicalIndicators {
  volumeRatio20: number;      // 20일 평균 대비 거래량 비율
  bbWidth: number;            // 볼린저밴드 폭
  bbSqueeze: boolean;         // BB 스퀴즈 여부
  sma5: number;               // 5일 이동평균
  sma20: number;              // 20일 이동평균
  goldenCross: boolean;       // 골든크로스 여부
  priceChange: number;        // 가격 변동률
}

// 감지 결과
export interface DetectionResult {
  id?: number;
  symbol: string;
  detectedAt: Date;
  score: number;
  reasons: string[];
  currentPrice: number;
  volume: number;
  session: MarketSession;
  technicals: TechnicalIndicators;
  secEvent: SecFiling | null;  // SEC 공시 정보 (있으면 객체, 없으면 null)
  isTracking: boolean;
}

// 가격 추적 히스토리
export interface PriceTrackHistory {
  id?: number;
  detectionId: number;
  symbol: string;
  timestamp: Date;
  session: MarketSession;
  price: number;
  volume: number;
  changePercent: number;  // 감지 시점 대비 변동률
}

// 감지 설정
export interface ScannerConfig {
  id?: number;
  symbol?: string;           // null이면 전체 스캔
  isActive: boolean;
  minScore: number;
  scanInterval: number;      // 분 단위
  createdAt?: Date;
}

// WebSocket 메시지 타입
export interface WSMessage {
  type: 'detection' | 'price_update' | 'scan_complete' | 'error';
  data: any;
  timestamp: Date;
}

// FMP API 응답 타입들
export interface FMPQuote {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  change: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  priceAvg50: number;
  priceAvg200: number;
  volume: number;
  avgVolume: number;
  exchange: string;
  open: number;
  previousClose: number;
  eps: number;
  pe: number;
  sharesOutstanding: number;
  timestamp: number;
}

export interface FMPProfile {
  symbol: string;
  price: number;
  beta: number;
  volAvg: number;
  mktCap: number;
  lastDiv: number;
  range: string;
  changes: number;
  companyName: string;
  currency: string;
  cik: string;
  isin: string;
  cusip: string;
  exchange: string;
  exchangeShortName: string;
  industry: string;
  website: string;
  description: string;
  ceo: string;
  sector: string;
  country: string;
  fullTimeEmployees: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  dcfDiff: number;
  dcf: number;
  image: string;
  ipoDate: string;
  defaultImage: boolean;
  isEtf: boolean;
  isActivelyTrading: boolean;
  isAdr: boolean;
  isFund: boolean;
  sharesOutstanding?: number;  // Float shares 정보 (optional)
}

export interface FMPHistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
  unadjustedVolume: number;
  change: number;
  changePercent: number;
  vwap: number;
  label: string;
  changeOverTime: number;
}

export interface FMPSecFiling {
  symbol: string;
  cik: string;
  type: string;
  link: string;
  finalLink: string;
  fillingDate?: string;
  filingDate?: string;
  acceptedDate: string;
}

export interface FMPAftermarketTrade {
  symbol: string;
  price: number;
  size: number;
  tradeSize?: number | null;
  timestamp: number;
}

// 가격 변동률 정보
export interface FMPPriceChange {
  symbol: string;
  '1D': number;    // 1일 변동률 (%)
  '5D': number;    // 5일 변동률 (%)
  '1M': number;    // 1개월 변동률 (%)
  '3M': number;    // 3개월 변동률 (%)
  '6M': number;    // 6개월 변동률 (%)
  ytd: number;     // 연초 대비 변동률 (%)
  '1Y': number;    // 1년 변동률 (%)
  '3Y': number;    // 3년 변동률 (%)
  '5Y': number;    // 5년 변동률 (%)
  '10Y': number;   // 10년 변동률 (%)
  max: number;     // 전체 기간 변동률 (%)
}

