// 한국투자증권 API 모듈 (KISApiManager 래퍼)
// 기존 코드와의 호환성을 위한 래퍼 클래스
import { kisApiManager } from './kis-api-manager.js'

export class KISApi {
  constructor() {
    // KISApiManager 싱글톤 사용
  }

  // 계정 정보 업데이트
  private updateConfig() {
    // KISApiManager가 자동으로 현재 계정 사용
  }

  // 잔고 조회 (KISApiManager로 위임)
  async getBalance(): Promise<any> {
    return kisApiManager.getBalance()
  }

  // 매수 주문 (KISApiManager로 위임)
  async buyStock(ticker: string, quantity: number, price?: number): Promise<any> {
    return kisApiManager.buyStock(ticker, quantity, price)
  }

  // 매도 주문 (KISApiManager로 위임)
  async sellStock(ticker: string, quantity: number, price?: number): Promise<any> {
    return kisApiManager.sellStock(ticker, quantity, price)
  }

  // 🔥 실시간 시세 조회 (KISApiManager로 위임)
  async getCurrentPrice(ticker: string): Promise<number | null> {
    return kisApiManager.getCurrentPrice(ticker)
  }

  // 결제기준잔고 조회 (KISApiManager로 위임)
  async getPaymentBalance(): Promise<{ cash: number; totalAssets: number }> {
    return kisApiManager.getPaymentBalance()
  }

  // 매수가능금액 조회 (KISApiManager로 위임)
  async getBuyingPower(ticker: string = 'QQQ', price: number = 1.0): Promise<{ cash: number; maxQuantity: number }> {
    return kisApiManager.getBuyingPower(ticker, price)
  }

  // 토큰 갱신 (KISApiManager로 위임)
  async getAccessToken(forceRefresh: boolean = false): Promise<string> {
    return kisApiManager.getAccessToken(forceRefresh)
  }

  // 토큰 강제 갱신
  async forceRefreshToken(): Promise<string> {
    return kisApiManager.refreshToken()
  }

  // 토큰 만료 에러 확인
  isTokenExpiredError(error: any): boolean {
    return kisApiManager.isTokenExpiredError(error)
  }

  // 현재 계정 정보 반환
  getCurrentAccount() {
    return kisApiManager.getCurrentAccount()
  }

  // 계정 타입 반환
  getCurrentAccountType() {
    return kisApiManager.getCurrentAccountType()
  }

  // Base URL 반환
  getBaseUrl(): string {
    return kisApiManager.getBaseUrl()
  }

  // TR ID 변환
  getTrId(baseTrId: string): string {
    return kisApiManager.getTrId(baseTrId)
  }

  // 차트 데이터 조회 메서드 (현재 미구현, FMP API 사용 권장)
  async getOverseasDailyChart(ticker: string, exchange: string, period: string, days: number): Promise<any[]> {
    // FMP API 사용 (로그 제거)
    return []
  }

  async getOverseasChartData(ticker: string, exchange: string, period: string | number, count: number): Promise<any[]> {
    // FMP API 사용 (로그 제거)
    return []
  }

  async getOverseasQuote(ticker: string, exchange: string): Promise<any> {
    // FMP API 사용 (로그 제거)
    return null
  }
}
