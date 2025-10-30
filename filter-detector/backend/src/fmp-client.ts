import axios, { AxiosInstance } from 'axios';
import { config } from './config';
import {
  FMPQuote,
  FMPProfile,
  FMPHistoricalPrice,
  FMPSecFiling,
  FMPAftermarketTrade,
  FMPPriceChange,
  StockInfo,
  MarketSession,
} from './types';

// FMP API 클라이언트 클래스
export class FMPClient {
  private api: AxiosInstance;
  private stableApi: AxiosInstance;
  private apiKey: string;

  constructor() {
    this.apiKey = config.fmp.apiKey;
    
    // v3 API 인스턴스
    this.api = axios.create({
      baseURL: config.fmp.baseUrl,
      timeout: 10000,
    });

    // stable API 인스턴스 (실시간 데이터용)
    this.stableApi = axios.create({
      baseURL: config.fmp.stableUrl,
      timeout: 10000,
    });
  }

  // 실시간 시세 조회
  async getQuote(symbol: string): Promise<FMPQuote | null> {
    try {
      const response = await this.stableApi.get('/quote', {
        params: {
          symbol: symbol.toUpperCase(),
          apikey: this.apiKey,
        },
      });

      if (Array.isArray(response.data) && response.data.length > 0) {
        return response.data[0];
      }
      return null;
    } catch (error) {
      console.error(`❌ ${symbol} 시세 조회 실패:`, error);
      return null;
    }
  }

  // 복수 종목 시세 조회
  async getQuotes(symbols: string[]): Promise<FMPQuote[]> {
    try {
      if (symbols.length === 0) return [];

      // FMP quote API는 각 심볼마다 개별 호출 필요 (배치 지원 안 함)
      const batchSize = 5; // 동시에 5개씩 처리
      const results: FMPQuote[] = [];

      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        
        const promises = batch.map(async symbol => {
          try {
            const response = await this.stableApi.get('/quote', {
              params: {
                symbol: symbol.toUpperCase(),
                apikey: this.apiKey,
              },
            });

            if (Array.isArray(response.data) && response.data.length > 0) {
              return response.data[0];
            }
            return null;
          } catch (err) {
            console.error(`⚠️ ${symbol} 시세 조회 실패`);
            return null;
          }
        });

        const batchResults = await Promise.all(promises);
        const validResults = batchResults.filter(r => r !== null) as FMPQuote[];
        results.push(...validResults);

        // Rate limiting
        if (i + batchSize < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      console.log(`  💹 시세 조회 성공: ${results.length}/${symbols.length}개`);
      return results;
    } catch (error) {
      console.error(`❌ 복수 종목 시세 조회 실패:`, error);
      return [];
    }
  }

  // 애프터마켓 거래 데이터 (단일)
  async getAftermarketTrade(symbol: string): Promise<FMPAftermarketTrade | null> {
    try {
      const response = await this.stableApi.get('/aftermarket-trade', {
        params: {
          symbol: symbol.toUpperCase(),
          apikey: this.apiKey,
        },
      });

      if (Array.isArray(response.data) && response.data.length > 0) {
        return response.data[0];
      }
      return null;
    } catch (error) {
      console.error(`❌ ${symbol} 애프터마켓 데이터 조회 실패:`, error);
      return null;
    }
  }

  // 애프터마켓 거래 데이터 (배치)
  async getBatchAftermarketTrade(symbols: string[]): Promise<FMPAftermarketTrade[]> {
    try {
      if (symbols.length === 0) return [];

      // 최대 100개씩 배치 처리
      const batchSize = 100;
      const results: FMPAftermarketTrade[] = [];

      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const symbolsStr = batch.map(s => s.toUpperCase()).join(',');

        const response = await this.stableApi.get('/batch-aftermarket-trade', {
          params: {
            symbols: symbolsStr,
            apikey: this.apiKey,
          },
        });

        if (Array.isArray(response.data)) {
          results.push(...response.data);
        }

        // Rate limiting: 짧은 대기 (배치 처리는 빠름)
        if (i + batchSize < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      return results;
    } catch (error) {
      console.error('❌ 배치 애프터마켓 데이터 조회 실패:', error);
      return [];
    }
  }

  // 가격 변동률 조회 (단일)
  async getPriceChange(symbol: string): Promise<FMPPriceChange | null> {
    try {
      const response = await this.stableApi.get('/stock-price-change', {
        params: {
          symbol: symbol.toUpperCase(),
          apikey: this.apiKey,
        },
      });

      if (Array.isArray(response.data) && response.data.length > 0) {
        return response.data[0];
      }
      return null;
    } catch (error) {
      console.error(`❌ ${symbol} 가격 변동률 조회 실패:`, error);
      return null;
    }
  }

  // 가격 변동률 조회 (배치)
  async getBatchPriceChange(symbols: string[]): Promise<Map<string, FMPPriceChange>> {
    try {
      if (symbols.length === 0) return new Map();

      const resultMap = new Map<string, FMPPriceChange>();
      
      // 병렬 처리 (한 번에 10개씩)
      const batchSize = 10;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        
        const promises = batch.map(symbol => this.getPriceChange(symbol));
        const results = await Promise.all(promises);

        results.forEach((result, index) => {
          if (result) {
            resultMap.set(batch[index], result);
          }
        });

        // Rate limiting
        if (i + batchSize < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      return resultMap;
    } catch (error) {
      console.error('❌ 배치 가격 변동률 조회 실패:', error);
      return new Map();
    }
  }

  // 회사 프로필 조회
  async getProfile(symbol: string): Promise<FMPProfile | null> {
    try {
      const response = await this.api.get(`/profile/${symbol.toUpperCase()}`, {
        params: { apikey: this.apiKey },
      });

      if (Array.isArray(response.data) && response.data.length > 0) {
        return response.data[0];
      }
      return null;
    } catch (error) {
      console.error(`❌ ${symbol} 프로필 조회 실패:`, error);
      return null;
    }
  }

  // 과거 가격 데이터 조회 (일봉)
  async getHistoricalPrices(
    symbol: string,
    days: number = 30
  ): Promise<FMPHistoricalPrice[]> {
    try {
      const response = await this.api.get(`/historical-price-full/${symbol.toUpperCase()}`, {
        params: {
          apikey: this.apiKey,
        },
      });

      const historical = response.data?.historical || [];
      return historical.slice(0, days);
    } catch (error) {
      console.error(`❌ ${symbol} 과거 가격 조회 실패:`, error);
      return [];
    }
  }

  // 인트라데이 차트 (1분, 5분, 15분, 30분, 1시간, 4시간)
  async getIntradayChart(
    symbol: string,
    interval: '1min' | '5min' | '15min' | '30min' | '1hour' | '4hour' = '5min'
  ): Promise<any[]> {
    try {
      const response = await this.api.get(`/historical-chart/${interval}/${symbol.toUpperCase()}`, {
        params: { apikey: this.apiKey },
      });

      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error(`❌ ${symbol} 인트라데이 차트 조회 실패:`, error);
      return [];
    }
  }

  // SEC 공시 조회
  async getSecFilings(symbol: string, limit: number = 20): Promise<FMPSecFiling[]> {
    try {
      const response = await this.api.get(`/sec_filings/${symbol.toUpperCase()}`, {
        params: {
          apikey: this.apiKey,
          limit,
        },
      });

      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error(`❌ ${symbol} SEC 공시 조회 실패:`, error);
      return [];
    }
  }

  // 나스닥 전체 종목 리스트 (동전주 필터링)
  async getNasdaqPennyStocks(maxPrice: number = 5): Promise<StockInfo[]> {
    try {
      // 나스닥 전체 종목 조회
      const response = await this.api.get('/stock/list', {
        params: { apikey: this.apiKey },
      });

      const stocks = Array.isArray(response.data) ? response.data : [];

      // 나스닥 동전주 필터링
      const pennyStocks = stocks.filter((stock: any) => {
        return (
          stock.exchangeShortName === 'NASDAQ' &&
          stock.price > 0 &&
          stock.price <= maxPrice &&
          stock.price >= 0.01
        );
      });

      return pennyStocks.map((stock: any) => ({
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchangeShortName,
        price: stock.price,
        volume: 0,
        marketCap: 0,
      }));
    } catch (error) {
      console.error('❌ 나스닥 동전주 리스트 조회 실패:', error);
      return [];
    }
  }

  // 활성 거래 종목 조회 (거래량 기준)
  async getActiveStocks(minVolume: number = 100000): Promise<StockInfo[]> {
    try {
      const response = await this.api.get('/actives', {
        params: { apikey: this.apiKey },
      });

      const stocks = Array.isArray(response.data) ? response.data : [];

      return stocks
        .filter((stock: any) => stock.volume >= minVolume)
        .map((stock: any) => ({
          symbol: stock.symbol,
          name: stock.name || stock.symbol,
          exchange: stock.exchange || 'NASDAQ',
          price: stock.price,
          volume: stock.volume,
          marketCap: stock.marketCap || 0,
        }));
    } catch (error) {
      console.error('❌ 활성 거래 종목 조회 실패:', error);
      return [];
    }
  }

  // 최대 상승 종목 조회 (Biggest Gainers)
  async getBiggestGainers(): Promise<StockInfo[]> {
    try {
      const response = await this.stableApi.get('/biggest-gainers', {
        params: { apikey: this.apiKey },
      });

      const stocks = Array.isArray(response.data) ? response.data : [];

      return stocks.map((stock: any) => ({
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchange,
        price: stock.price,
        volume: 0, // 거래량 정보 없음
        marketCap: 0,
        changePercent: stock.changesPercentage,
      }));
    } catch (error) {
      console.error('❌ 최대 상승 종목 조회 실패:', error);
      return [];
    }
  }

  // 최대 거래량 종목 조회 (Most Actives)
  async getMostActives(): Promise<StockInfo[]> {
    try {
      const response = await this.stableApi.get('/most-actives', {
        params: { apikey: this.apiKey },
      });

      const stocks = Array.isArray(response.data) ? response.data : [];

      return stocks.map((stock: any) => ({
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchange,
        price: stock.price,
        volume: 0, // API 응답에 포함되어 있을 수 있음
        marketCap: 0,
        changePercent: stock.changesPercentage,
      }));
    } catch (error) {
      console.error('❌ 최대 거래량 종목 조회 실패:', error);
      return [];
    }
  }

  // 현재 시장 세션 판단
  getMarketSession(): MarketSession {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const totalMinutes = utcHours * 60 + utcMinutes;

    // 미국 동부 시간 기준 (UTC-5 또는 UTC-4)
    // Premarket: 04:00 - 09:30 ET (09:00 - 14:30 UTC 여름 / 10:00 - 15:30 UTC 겨울)
    // Regular: 09:30 - 16:00 ET (14:30 - 21:00 UTC 여름 / 15:30 - 22:00 UTC 겨울)
    // Aftermarket: 16:00 - 20:00 ET (21:00 - 01:00 UTC 여름 / 22:00 - 02:00 UTC 겨울)

    // 간단히 UTC 기준으로 판단 (여름시간 기준)
    if (totalMinutes >= 540 && totalMinutes < 870) {
      // 09:00 - 14:30 UTC
      return 'premarket';
    } else if (totalMinutes >= 870 && totalMinutes < 1260) {
      // 14:30 - 21:00 UTC
      return 'regular';
    } else if (totalMinutes >= 1260 || totalMinutes < 60) {
      // 21:00 - 01:00 UTC (다음날)
      return 'aftermarket';
    }

    return 'closed';
  }

  // 시장 개장 여부
  isMarketOpen(): boolean {
    const session = this.getMarketSession();
    return session !== 'closed';
  }
}

// 싱글톤 인스턴스
export const fmpClient = new FMPClient();

