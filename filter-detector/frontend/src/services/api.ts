import axios from 'axios';
import { DetectionResult, PriceTrackHistory, ScannerConfig, MarketStatus } from '../types';

// API 클라이언트 설정
const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// API 서비스
export const apiService = {
  // 감지 목록 조회
  async getDetections(limit: number = 50, offset: number = 0): Promise<DetectionResult[]> {
    const response = await api.get('/detections', {
      params: { limit, offset },
    });
    return response.data.data;
  },

  // 추적 중인 감지 목록
  async getActiveDetections(): Promise<DetectionResult[]> {
    const response = await api.get('/detections/active');
    return response.data.data;
  },

  // 특정 감지의 가격 히스토리
  async getPriceHistory(detectionId: number): Promise<PriceTrackHistory[]> {
    const response = await api.get(`/detections/${detectionId}/history`);
    return response.data.data;
  },

  // 추적 중지
  async stopTracking(detectionId: number): Promise<void> {
    await api.post(`/detections/${detectionId}/stop`);
  },

  // 수동 스캔 실행
  async runManualScan(params: {
    scanType: 'pennystock' | 'active' | 'gainers' | 'most-actives' | 'custom';
    symbols?: string[];
    maxPrice?: number;
    minVolume?: number;
  }): Promise<DetectionResult[]> {
    const response = await api.post('/scan/manual', params);
    return response.data.data;
  },

  // 단일 종목 분석
  async analyzeSymbol(symbol: string): Promise<DetectionResult | null> {
    const response = await api.post('/scan/symbol', { symbol });
    return response.data.data;
  },

  // 스캐너 설정 조회
  async getScannerConfig(): Promise<ScannerConfig> {
    const response = await api.get('/scanner/config');
    return response.data.data;
  },

  // 스캐너 설정 업데이트
  async updateScannerConfig(config: Partial<ScannerConfig>): Promise<void> {
    await api.put('/scanner/config', config);
  },

  // 시장 상태 조회
  async getMarketStatus(): Promise<MarketStatus> {
    const response = await api.get('/market/status');
    return response.data.data;
  },

  // 실시간 가격 조회
  async getPrice(symbol: string): Promise<{
    price: number;
    volume: number;
    session: string;
  }> {
    const response = await api.get(`/price/${symbol}`);
    return response.data.data;
  },
};

