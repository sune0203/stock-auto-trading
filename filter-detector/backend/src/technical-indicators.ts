import { FMPHistoricalPrice, TechnicalIndicators } from './types';

// 기술적 지표 계산 유틸리티
export class TechnicalAnalyzer {
  
  // 단순 이동평균 (SMA) 계산
  private calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) {
      return 0;
    }

    const sum = prices.slice(0, period).reduce((acc, price) => acc + price, 0);
    return sum / period;
  }

  // 표준편차 계산
  private calculateStdDev(prices: number[], period: number): number {
    if (prices.length < period) {
      return 0;
    }

    const slice = prices.slice(0, period);
    const mean = slice.reduce((acc, price) => acc + price, 0) / period;
    const variance = slice.reduce((acc, price) => acc + Math.pow(price - mean, 2), 0) / period;
    
    return Math.sqrt(variance);
  }

  // 볼린저밴드 계산
  private calculateBollingerBands(
    prices: number[],
    period: number = 20,
    stdDevMultiplier: number = 2
  ): { upper: number; middle: number; lower: number; width: number } {
    const middle = this.calculateSMA(prices, period);
    const stdDev = this.calculateStdDev(prices, period);
    const upper = middle + stdDev * stdDevMultiplier;
    const lower = middle - stdDev * stdDevMultiplier;
    const width = upper - lower;

    return { upper, middle, lower, width };
  }

  // 볼린저밴드 스퀴즈 감지
  private isBBSqueeze(
    currentWidth: number,
    historicalWidths: number[]
  ): boolean {
    if (historicalWidths.length < 20) {
      return false;
    }

    // 현재 BB 폭이 과거 20일 평균보다 작으면 스퀴즈
    const avgWidth = historicalWidths.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    return currentWidth < avgWidth * 0.7; // 70% 이하면 스퀴즈
  }

  // 골든크로스 감지 (5일선이 20일선 상향 돌파)
  private isGoldenCross(
    sma5Current: number,
    sma20Current: number,
    sma5Previous: number,
    sma20Previous: number
  ): boolean {
    // 이전에는 5일선이 20일선 아래, 현재는 위
    return sma5Previous <= sma20Previous && sma5Current > sma20Current;
  }

  // 거래량 비율 계산 (최근 vs 평균)
  private calculateVolumeRatio(
    currentVolume: number,
    historicalVolumes: number[],
    period: number = 20
  ): number {
    if (historicalVolumes.length < period) {
      return 1;
    }

    const avgVolume = historicalVolumes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    if (avgVolume === 0) {
      return 1;
    }

    return currentVolume / avgVolume;
  }

  // 가격 변동률 계산
  private calculatePriceChange(currentPrice: number, previousClose: number): number {
    if (previousClose === 0) {
      return 0;
    }

    return (currentPrice - previousClose) / previousClose;
  }

  // 종합 기술적 지표 계산
  async analyzeTechnicals(
    currentPrice: number,
    currentVolume: number,
    historicalData: FMPHistoricalPrice[]
  ): Promise<TechnicalIndicators> {
    if (historicalData.length < 20) {
      // 데이터가 부족하면 기본값 반환
      return {
        volumeRatio20: 1,
        bbWidth: 0,
        bbSqueeze: false,
        sma5: currentPrice,
        sma20: currentPrice,
        goldenCross: false,
        priceChange: 0,
      };
    }

    // 가격 배열 (최신 데이터가 앞에)
    const closePrices = historicalData.map(d => d.close);
    const volumes = historicalData.map(d => d.volume);

    // 이동평균 계산
    const sma5 = this.calculateSMA(closePrices, 5);
    const sma20 = this.calculateSMA(closePrices, 20);
    
    // 이전 이동평균 (골든크로스 감지용)
    const sma5Prev = historicalData.length > 5 
      ? this.calculateSMA(closePrices.slice(1), 5) 
      : sma5;
    const sma20Prev = historicalData.length > 20 
      ? this.calculateSMA(closePrices.slice(1), 20) 
      : sma20;

    // 볼린저밴드
    const bb = this.calculateBollingerBands(closePrices, 20, 2);
    
    // 과거 BB 폭 계산
    const historicalWidths: number[] = [];
    for (let i = 0; i < Math.min(40, historicalData.length - 20); i++) {
      const bbHistorical = this.calculateBollingerBands(closePrices.slice(i), 20, 2);
      historicalWidths.push(bbHistorical.width);
    }

    // 거래량 비율
    const volumeRatio20 = this.calculateVolumeRatio(currentVolume, volumes, 20);

    // 가격 변동률
    const priceChange = historicalData.length > 0 
      ? this.calculatePriceChange(currentPrice, historicalData[0].close)
      : 0;

    // 골든크로스 감지
    const goldenCross = this.isGoldenCross(sma5, sma20, sma5Prev, sma20Prev);

    // BB 스퀴즈 감지
    const bbSqueeze = this.isBBSqueeze(bb.width, historicalWidths);

    return {
      volumeRatio20,
      bbWidth: bb.width,
      bbSqueeze,
      sma5,
      sma20,
      goldenCross,
      priceChange,
    };
  }

  // 간단한 점수 계산 (0-100)
  calculateTechnicalScore(indicators: TechnicalIndicators): number {
    let score = 0;

    // 거래량 증가
    if (indicators.volumeRatio20 >= 2.0) score += 30;
    else if (indicators.volumeRatio20 >= 1.5) score += 20;
    else if (indicators.volumeRatio20 >= 1.2) score += 10;

    // 볼린저밴드 스퀴즈
    if (indicators.bbSqueeze) score += 15;

    // 가격 안정성 (보합 매집)
    const absChange = Math.abs(indicators.priceChange);
    if (absChange <= 0.01) score += 10;
    else if (absChange <= 0.03) score += 5;

    // 골든크로스
    if (indicators.goldenCross) score += 10;

    // 5일선이 20일선 위에 있으면 추가 점수
    if (indicators.sma5 > indicators.sma20) score += 5;

    return Math.min(score, 100);
  }
}

// 싱글톤 인스턴스
export const technicalAnalyzer = new TechnicalAnalyzer();

