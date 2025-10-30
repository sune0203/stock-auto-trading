import { config } from './config';
import { fmpClient } from './fmp-client';
import { 
  getActiveDetections, 
  savePriceTrack, 
  stopTracking 
} from './database';
import { DetectionResult, PriceTrackHistory } from './types';

// 가격 추적 서비스
export class PriceTracker {
  private intervalId: NodeJS.Timeout | null = null;
  private isTracking: boolean = false;
  private onUpdateCallback?: (update: PriceTrackHistory) => void;

  // 추적 시작
  start(onUpdate?: (update: PriceTrackHistory) => void) {
    if (this.isTracking) {
      console.log('⚠️ 가격 추적이 이미 실행 중입니다.');
      return;
    }

    this.onUpdateCallback = onUpdate;
    this.isTracking = true;

    const intervalSeconds = config.scanner.priceTrackIntervalSeconds;
    console.log(`🎯 가격 추적 시작 (${intervalSeconds}초 간격)`);

    // 즉시 한 번 실행
    this.trackPrices();

    // 주기적 실행
    this.intervalId = setInterval(() => {
      this.trackPrices();
    }, intervalSeconds * 1000);
  }

  // 추적 중지
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isTracking = false;
    console.log('🛑 가격 추적 중지');
  }

  // 가격 추적 실행
  private async trackPrices() {
    try {
      // 추적 중인 감지 목록 조회
      const activeDetections = await getActiveDetections();

      if (activeDetections.length === 0) {
        console.log('ℹ️ 추적 중인 종목 없음');
        return;
      }

      console.log(`📊 ${activeDetections.length}개 종목 가격 추적 중...`);

      // 심볼 추출
      const symbols = activeDetections.map(d => d.symbol);

      // 현재 세션 확인
      const session = fmpClient.getMarketSession();

      // 세션에 따라 다른 API 사용
      let priceData: Map<string, { price: number; volume: number }> = new Map();

      if (session === 'aftermarket' || session === 'premarket') {
        // 애프터마켓/프리마켓: 배치 애프터마켓 API 사용
        const aftermarketData = await fmpClient.getBatchAftermarketTrade(symbols);
        
        aftermarketData.forEach(data => {
          priceData.set(data.symbol, {
            price: data.price,
            volume: 0, // 애프터마켓은 거래량 정보 없음
          });
        });

        console.log(`  📡 애프터마켓 배치 데이터: ${aftermarketData.length}개 조회`);
      } else {
        // 정규장: 일반 시세 API 사용
        const quotes = await fmpClient.getQuotes(symbols);
        
        quotes.forEach(quote => {
          priceData.set(quote.symbol, {
            price: quote.price,
            volume: quote.volume,
          });
        });

        console.log(`  📡 정규장 시세: ${quotes.length}개 조회`);
      }

      if (priceData.size === 0) {
        console.log('⚠️ 가격 데이터 조회 실패');
        return;
      }

      // 각 감지 항목에 대해 처리
      for (const detection of activeDetections) {
        const data = priceData.get(detection.symbol);
        
        if (!data || data.price === 0) {
          continue;
        }

        // 변동률 계산 (감지 시점 대비)
        const changePercent = ((data.price - detection.currentPrice) / detection.currentPrice) * 100;

        // 가격 추적 히스토리 생성
        const track: PriceTrackHistory = {
          detectionId: detection.id!,
          symbol: detection.symbol,
          timestamp: new Date(),
          session,
          price: data.price,
          volume: data.volume,
          changePercent,
        };

        // DB에 저장
        await savePriceTrack(track);

        // 콜백 호출
        if (this.onUpdateCallback) {
          this.onUpdateCallback(track);
        }

        console.log(
          `  ${detection.symbol}: $${data.price.toFixed(4)} ` +
          `(${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%) ` +
          `[${session}]`
        );
      }
    } catch (error) {
      console.error('❌ 가격 추적 중 오류:', error);
    }
  }

  // 특정 종목 추적 중지
  async stopTrackingSymbol(detectionId: number) {
    await stopTracking(detectionId);
    console.log(`🛑 감지 ID ${detectionId} 추적 중지`);
  }

  // 추적 상태 확인
  getStatus(): { isTracking: boolean; interval: number } {
    return {
      isTracking: this.isTracking,
      interval: config.scanner.priceTrackIntervalSeconds,
    };
  }

  // 단일 종목 즉시 조회
  async getPriceNow(symbol: string): Promise<{
    price: number;
    volume: number;
    session: string;
  } | null> {
    try {
      const quote = await fmpClient.getQuote(symbol);
      if (!quote || quote.price === 0) {
        return null;
      }

      const session = fmpClient.getMarketSession();

      return {
        price: quote.price,
        volume: quote.volume,
        session,
      };
    } catch (error) {
      console.error(`❌ ${symbol} 가격 조회 실패:`, error);
      return null;
    }
  }
}

// 싱글톤 인스턴스
export const priceTracker = new PriceTracker();

