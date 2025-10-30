// 시장 세션 타입
export type MarketSession = 'premarket' | 'regular' | 'aftermarket' | 'closed';

// 기술적 지표
export interface TechnicalIndicators {
  volumeRatio20: number;
  bbWidth: number;
  bbSqueeze: boolean;
  sma5: number;
  sma20: number;
  goldenCross: boolean;
  priceChange: number;
}

// SEC 공시 정보
export interface SecFiling {
  symbol: string;
  type: string;
  filingDate: string;
  url?: string;
  analysis?: {
    summary: string;
    upProbability: number;
    positiveScore: number;
    negativeScore: number;
    keyPoints: string[];
    recommendation: string;
  };
}

// 감지 결과
export interface DetectionResult {
  id?: number;
  symbol: string;
  detectedAt: string;
  score: number;
  reasons: string[];
  currentPrice: number;
  volume: number;
  session: MarketSession;
  technicals: TechnicalIndicators;
  secEvent: SecFiling | null;  // SEC 공시 정보
  isTracking: boolean;
}

// 가격 추적 히스토리
export interface PriceTrackHistory {
  id?: number;
  detectionId: number;
  symbol: string;
  timestamp: string;
  session: MarketSession;
  price: number;
  volume: number;
  changePercent: number;
}

// WebSocket 메시지
export interface WSMessage {
  type: 'detection' | 'price_update' | 'scan_complete' | 'error' | 'connected';
  data: any;
  timestamp: string;
}

// 스캐너 설정
export interface ScannerConfig {
  id?: number;
  symbol?: string;
  isActive: boolean;
  minScore: number;
  scanInterval: number;
}

// 시장 상태
export interface MarketStatus {
  session: MarketSession;
  isOpen: boolean;
  timestamp: string;
}

