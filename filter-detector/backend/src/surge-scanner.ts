import { config } from './config';
import { fmpClient } from './fmp-client';
import { secMonitor } from './sec-monitor';
import { technicalAnalyzer } from './technical-indicators';
import { saveDetection } from './database';
import { DetectionResult, StockInfo, SecFiling } from './types';
import { geminiClient } from './gemini-api';

// 급등주 스캐너 클래스
export class SurgeScanner {
  private isScanning: boolean = false;
  private lastScanTime: Date | null = null;

  // 단일 종목 분석
  async analyzeStock(symbol: string): Promise<DetectionResult | null> {
    try {
      console.log(`📊 ${symbol} 분석 시작...`);

      // 1. 현재 시세 조회
      const quote = await fmpClient.getQuote(symbol);
      if (!quote || quote.price === 0) {
        console.log(`⚠️ ${symbol} 시세 조회 실패`);
        return null;
      }

      // 2. 프로필 조회 (Float 정보)
      const profile = await fmpClient.getProfile(symbol);
      const floatShares = profile?.sharesOutstanding || 0;

      // 3. 과거 가격 데이터 조회
      const historicalPrices = await fmpClient.getHistoricalPrices(symbol, 30);
      if (historicalPrices.length < 20) {
        console.log(`⚠️ ${symbol} 과거 데이터 부족`);
        return null;
      }

      // 4. 기술적 지표 계산
      const technicals = await technicalAnalyzer.analyzeTechnicals(
        quote.price,
        quote.volume,
        historicalPrices
      );

      // 5. SEC 이벤트 감지 및 Gemini 분석
      const secEventBasic = await secMonitor.hasRecentEvent(symbol);
      let secEvent: SecFiling | null = null;

      if (secEventBasic) {
        // SEC 공시 상세 정보 가져오기
        const secDetails = await secMonitor.getRecentFilingDetails(symbol);
        
        if (secDetails) {
          console.log(`📋 ${symbol} SEC 공시 발견: ${secDetails.formType}, URL: ${secDetails.url ? '있음' : '없음'}`);
          
          secEvent = {
            symbol,
            type: secDetails.formType,
            filingDate: new Date(secDetails.filedAt),
            url: secDetails.url,
          };

          // Gemini API로 공시 분석 (URL 있을 때만)
          if (secDetails.url) {
            try {
              console.log(`🤖 ${symbol} Gemini 분석 시작...`);
              
              const analysis = await geminiClient.analyzeSECFilingByURL(
                symbol,
                secDetails.formType,
                secDetails.url
              );
              
              if (analysis) {
                secEvent.analysis = analysis;
                console.log(`✅ ${symbol} Gemini 분석 완료:`);
                console.log(`   요약: ${analysis.summary}`);
                console.log(`   상승확률: ${analysis.upProbability}%`);
                console.log(`   호재: ${analysis.positiveScore}/10, 악재: ${analysis.negativeScore}/10`);
                console.log(`   추천: ${analysis.recommendation}`);
              } else {
                console.warn(`⚠️ ${symbol} Gemini 분석 결과 없음`);
              }
            } catch (error: any) {
              console.error(`❌ ${symbol} Gemini 분석 실패:`, error.message);
              
              // 기본 분석 제공
              secEvent.analysis = {
                summary: `${secDetails.formType} 공시가 제출되었습니다. 상세 분석은 공시 문서를 확인하세요.`,
                upProbability: 50,
                positiveScore: 5,
                negativeScore: 5,
                keyPoints: ['공시 제출', '추가 분석 필요'],
                recommendation: '관망',
              };
            }
          } else {
            console.warn(`⚠️ ${symbol} SEC 공시 URL 없음, 기본 분석 제공`);
            
            // URL 없으면 기본 분석
            secEvent.analysis = {
              summary: `${secDetails.formType} 공시가 감지되었으나 상세 URL이 없습니다.`,
              upProbability: 50,
              positiveScore: 5,
              negativeScore: 5,
              keyPoints: ['공시 감지', 'URL 없음'],
              recommendation: '관망',
            };
          }
        }
      }

      // 6. 점수 계산
      let score = 0;
      const reasons: string[] = [];

      // 거래량 비율
      if (technicals.volumeRatio20 >= 2.0) {
        score += config.scanner.weights.volumeRatio + 5;
        reasons.push(`거래량 2배 이상 증가 (${technicals.volumeRatio20.toFixed(2)}배)`);
      } else if (technicals.volumeRatio20 >= config.scanner.thresholds.volumeRatioMin) {
        score += config.scanner.weights.volumeRatio;
        reasons.push(`거래량 증가 (${technicals.volumeRatio20.toFixed(2)}배)`);
      }

      // 볼린저밴드 스퀴즈
      if (technicals.bbSqueeze) {
        score += config.scanner.weights.bbSqueeze;
        reasons.push('볼린저밴드 축소 (변동성 압축)');
      }

      // 가격 안정성 (보합 매집)
      const absChange = Math.abs(technicals.priceChange);
      if (absChange <= 0.01) {
        score += config.scanner.weights.priceStability;
        reasons.push('가격 보합 매집 패턴');
      } else if (absChange <= config.scanner.thresholds.priceChangeMax) {
        score += Math.floor(config.scanner.weights.priceStability / 2);
        reasons.push('가격 안정적');
      }

      // 골든크로스
      if (technicals.goldenCross) {
        score += config.scanner.weights.goldenCross;
        reasons.push('골든크로스 발생 (5일선↗20일선)');
      } else if (technicals.sma5 > technicals.sma20) {
        score += Math.floor(config.scanner.weights.goldenCross / 2);
        reasons.push('5일선이 20일선 위');
      }

      // Float (유통 주식 수)
      if (floatShares > 0 && floatShares < config.scanner.thresholds.maxFloatShares) {
        score += config.scanner.weights.lowFloat;
        reasons.push(`낮은 유통량 (${(floatShares / 1000000).toFixed(1)}M)`);
      }

      // SEC 이벤트
      if (secEvent) {
        score += config.scanner.weights.secEvent;
        reasons.push('최근 SEC 공시 발견');
      }

      // 7. 임계값 확인
      if (score < config.scanner.thresholds.minScore) {
        console.log(`ℹ️ ${symbol} 점수 부족: ${score}점`);
        return null;
      }

      // 8. 현재 세션 확인
      const session = fmpClient.getMarketSession();

      // 9. 감지 결과 생성
      const detection: DetectionResult = {
        symbol,
        detectedAt: new Date(),
        score,
        reasons,
        currentPrice: quote.price,
        volume: quote.volume,
        session,
        technicals,
        secEvent,
        isTracking: true,
      };

      console.log(`✅ ${symbol} 급등 가능성 감지! 점수: ${score}점`);
      console.log(`   이유: ${reasons.join(', ')}`);

      return detection;
    } catch (error) {
      console.error(`❌ ${symbol} 분석 중 오류:`, error);
      return null;
    }
  }

  // 여러 종목 스캔
  async scanStocks(symbols: string[]): Promise<DetectionResult[]> {
    if (this.isScanning) {
      console.log('⚠️ 이미 스캔 진행 중입니다.');
      return [];
    }

    this.isScanning = true;
    this.lastScanTime = new Date();
    const detections: DetectionResult[] = [];

    console.log(`\n🚀 ${symbols.length}개 종목 스캔 시작... (${this.lastScanTime.toLocaleString()})`);

    try {
      // 병렬 처리 (한 번에 5개씩)
      const batchSize = 5;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(symbol => this.analyzeStock(symbol))
        );

        const validResults = results.filter(r => r !== null) as DetectionResult[];
        detections.push(...validResults);

        // 진행 상황 출력
        console.log(`진행: ${Math.min(i + batchSize, symbols.length)}/${symbols.length}`);
      }

      // DB에 저장
      for (const detection of detections) {
        const id = await saveDetection(detection);
        detection.id = id;
      }

      console.log(`\n✅ 스캔 완료! ${detections.length}개 급등 가능성 종목 발견`);
    } catch (error) {
      console.error('❌ 스캔 중 오류:', error);
    } finally {
      this.isScanning = false;
    }

    return detections;
  }

  // 나스닥 동전주 전체 스캔
  async scanNasdaqPennyStocks(maxPrice: number = 5): Promise<DetectionResult[]> {
    console.log(`🔍 나스닥 동전주 (< $${maxPrice}) 스캔 시작...`);

    // 동전주 리스트 조회
    const pennyStocks = await fmpClient.getNasdaqPennyStocks(maxPrice);
    console.log(`📋 ${pennyStocks.length}개 동전주 발견`);

    if (pennyStocks.length === 0) {
      return [];
    }

    // 거래량이 있는 종목만 필터링
    const activeStocks = pennyStocks.filter(stock => stock.volume > 0);
    const symbols = activeStocks.map(stock => stock.symbol);

    return await this.scanStocks(symbols);
  }

  // 활성 거래 종목 스캔
  async scanActiveStocks(minVolume: number = 100000): Promise<DetectionResult[]> {
    console.log(`🔍 활성 거래 종목 (거래량 > ${minVolume}) 스캔 시작...`);

    const activeStocks = await fmpClient.getActiveStocks(minVolume);
    console.log(`📋 ${activeStocks.length}개 활성 종목 발견`);

    if (activeStocks.length === 0) {
      return [];
    }

    const symbols = activeStocks.map(stock => stock.symbol);
    return await this.scanStocks(symbols);
  }

  // 커스텀 심볼 리스트 스캔
  async scanCustomSymbols(symbols: string[]): Promise<DetectionResult[]> {
    console.log(`🔍 커스텀 ${symbols.length}개 종목 스캔 시작...`);
    return await this.scanStocks(symbols);
  }

  // 최대 상승 종목 스캔 (Biggest Gainers) - 가격 변동률 필터 적용
  async scanBiggestGainers(): Promise<DetectionResult[]> {
    console.log(`🔍 최대 상승 종목 (Biggest Gainers) 스캔 시작...`);

    const gainers = await fmpClient.getBiggestGainers();
    console.log(`📋 ${gainers.length}개 상승 종목 발견`);

    if (gainers.length === 0) {
      return [];
    }

    // 나스닥 종목만 필터링 (동전주 포함)
    let nasdaqGainers = gainers.filter(
      stock => stock.exchange === 'NASDAQ' && stock.price <= 10
    );

    const symbols = nasdaqGainers.map(stock => stock.symbol);
    console.log(`📋 나스닥 $10 이하 상승 종목: ${symbols.length}개`);

    // 가격 변동률 데이터로 추가 필터링
    const priceChanges = await fmpClient.getBatchPriceChange(symbols);
    
    // 최근 급등 종목만 선택 (1D > 10% 또는 5D > 20%)
    const filteredSymbols = symbols.filter(symbol => {
      const priceChange = priceChanges.get(symbol);
      if (!priceChange) return true; // 데이터 없으면 포함

      const oneDayChange = priceChange['1D'];
      const fiveDayChange = priceChange['5D'];

      // 최근 급등 조건
      return oneDayChange > 10 || fiveDayChange > 20;
    });

    console.log(`📊 가격 변동률 필터 후: ${filteredSymbols.length}개`);

    return await this.scanStocks(filteredSymbols);
  }

  // 최대 거래량 종목 스캔 (Most Actives)
  async scanMostActives(): Promise<DetectionResult[]> {
    console.log(`🔍 최대 거래량 종목 (Most Actives) 스캔 시작...`);

    const actives = await fmpClient.getMostActives();
    console.log(`📋 ${actives.length}개 활성 종목 발견`);

    if (actives.length === 0) {
      return [];
    }

    // 나스닥 종목만 필터링 (동전주 포함)
    const nasdaqActives = actives.filter(
      stock => stock.exchange === 'NASDAQ' && stock.price <= 10
    );

    const symbols = nasdaqActives.map(stock => stock.symbol);
    console.log(`📋 나스닥 $10 이하 활성 종목: ${symbols.length}개`);

    return await this.scanStocks(symbols);
  }

  // 스캔 상태 확인
  getStatus(): { isScanning: boolean; lastScanTime: Date | null } {
    return {
      isScanning: this.isScanning,
      lastScanTime: this.lastScanTime,
    };
  }
}

// 싱글톤 인스턴스
export const surgeScanner = new SurgeScanner();

