import axios from 'axios';
import { config } from './config';
import { fmpClient } from './fmp-client';
import { SecFiling } from './types';

// SEC 공시 모니터 클래스
export class SecMonitor {
  private readonly userAgent: string;
  private readonly rateLimit: number;
  private readonly targetForms: Set<string>;
  private readonly lookbackDays: number;

  constructor() {
    this.userAgent = config.sec.userAgent;
    this.rateLimit = config.sec.rateLimit;
    this.targetForms = new Set(config.sec.targetForms);
    this.lookbackDays = config.scanner.eventLookbackDays;
  }

  // Rate limit 처리
  private async delay(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, this.rateLimit * 1000));
  }

  // CIK 번호 조회 (FMP 프로필에서)
  private async getCik(symbol: string): Promise<string | null> {
    try {
      const profile = await fmpClient.getProfile(symbol);
      if (profile && profile.cik) {
        // CIK를 10자리로 패딩 후 앞의 0 제거
        return profile.cik.toString().padStart(10, '0').replace(/^0+/, '');
      }
      return null;
    } catch (error) {
      console.error(`❌ ${symbol} CIK 조회 실패:`, error);
      return null;
    }
  }

  // EDGAR RSS 피드에서 최근 공시 확인
  private async checkEdgarRss(symbol: string): Promise<boolean> {
    try {
      const rssUrl = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&output=atom';
      
      const response = await axios.get(rssUrl, {
        headers: {
          'User-Agent': this.userAgent,
        },
        timeout: 10000,
      });

      const xmlData = response.data;
      const symbolLower = symbol.toLowerCase();

      // 간단한 XML 파싱 (정규표현식 사용)
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      const titleRegex = /<title>(.*?)<\/title>/;
      const summaryRegex = /<summary[^>]*>(.*?)<\/summary>/;
      const updatedRegex = /<updated>(.*?)<\/updated>/;

      let match;
      while ((match = entryRegex.exec(xmlData)) !== null) {
        const entry = match[1];
        const titleMatch = entry.match(titleRegex);
        const summaryMatch = entry.match(summaryRegex);
        const updatedMatch = entry.match(updatedRegex);

        if (titleMatch || summaryMatch) {
          const title = (titleMatch?.[1] || '').toLowerCase();
          const summary = (summaryMatch?.[1] || '').toLowerCase();

          if (title.includes(symbolLower) || summary.includes(symbolLower)) {
            if (updatedMatch) {
              const filingDate = new Date(updatedMatch[1]);
              const daysDiff = (Date.now() - filingDate.getTime()) / (1000 * 60 * 60 * 24);
              
              if (daysDiff <= this.lookbackDays) {
                return true;
              }
            } else {
              // 날짜 정보가 없으면 최근 공시로 간주
              return true;
            }
          }
        }
      }

      await this.delay();
      return false;
    } catch (error) {
      console.error(`❌ ${symbol} EDGAR RSS 확인 실패:`, error);
      return false;
    }
  }

  // FMP SEC Filings API로 최근 공시 확인
  private async checkFmpFilings(symbol: string): Promise<SecFiling | null> {
    try {
      const filings = await fmpClient.getSecFilings(symbol, 10);

      for (const filing of filings) {
        const formType = (filing.type || '').toUpperCase();
        
        if (this.targetForms.has(formType)) {
          const filingDateStr = filing.fillingDate || filing.filingDate;
          
          if (filingDateStr) {
            const filingDate = new Date(filingDateStr);
            const daysDiff = (Date.now() - filingDate.getTime()) / (1000 * 60 * 60 * 24);

            if (daysDiff <= this.lookbackDays) {
              return {
                symbol,
                type: formType,
                filingDate,
                url: filing.finalLink || filing.link,
              };
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`❌ ${symbol} FMP SEC 공시 확인 실패:`, error);
      return null;
    }
  }

  // EDGAR Company Feed에서 최근 공시 확인
  private async checkEdgarCompanyFeed(symbol: string): Promise<boolean> {
    try {
      const cik = await this.getCik(symbol);
      if (!cik) {
        return false;
      }

      const formTypesQuery = Array.from(this.targetForms).join('+');
      const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${formTypesQuery}&count=40&output=atom`;

      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.userAgent,
        },
        timeout: 10000,
      });

      const xmlData = response.data;

      // entry에서 published 또는 updated 날짜 확인
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      const publishedRegex = /<published>(.*?)<\/published>/;
      const updatedRegex = /<updated>(.*?)<\/updated>/;

      let match;
      while ((match = entryRegex.exec(xmlData)) !== null) {
        const entry = match[1];
        const publishedMatch = entry.match(publishedRegex);
        const updatedMatch = entry.match(updatedRegex);

        const dateStr = publishedMatch?.[1] || updatedMatch?.[1];
        
        if (dateStr) {
          const filingDate = new Date(dateStr);
          const daysDiff = (Date.now() - filingDate.getTime()) / (1000 * 60 * 60 * 24);

          if (daysDiff <= this.lookbackDays) {
            return true;
          }
        }
      }

      await this.delay();
      return false;
    } catch (error) {
      console.error(`❌ ${symbol} EDGAR Company Feed 확인 실패:`, error);
      return false;
    }
  }

  // 종합 이벤트 감지 (여러 소스 확인)
  async detectRecentEvent(symbol: string): Promise<SecFiling | null> {
    console.log(`🔍 ${symbol} SEC 이벤트 감지 시작...`);

    // 1. FMP SEC Filings (가장 신뢰성 높음)
    const fmpFiling = await this.checkFmpFilings(symbol);
    if (fmpFiling) {
      console.log(`✅ ${symbol} FMP에서 최근 공시 발견: ${fmpFiling.type}`);
      return fmpFiling;
    }

    // 2. EDGAR Company Feed
    const edgarCompanyResult = await this.checkEdgarCompanyFeed(symbol);
    if (edgarCompanyResult) {
      console.log(`✅ ${symbol} EDGAR Company Feed에서 최근 공시 발견`);
      return {
        symbol,
        type: 'EDGAR_COMPANY',
        filingDate: new Date(),
      };
    }

    // 3. EDGAR RSS (백업)
    const edgarRssResult = await this.checkEdgarRss(symbol);
    if (edgarRssResult) {
      console.log(`✅ ${symbol} EDGAR RSS에서 최근 공시 발견`);
      return {
        symbol,
        type: 'EDGAR_RSS',
        filingDate: new Date(),
      };
    }

    console.log(`ℹ️ ${symbol} 최근 SEC 이벤트 없음`);
    return null;
  }

  // 간단한 이벤트 여부만 확인 (boolean)
  async hasRecentEvent(symbol: string): Promise<boolean> {
    const event = await this.detectRecentEvent(symbol);
    return event !== null;
  }

  // 최근 공시 상세 정보 가져오기 (Gemini 분석용)
  async getRecentFilingDetails(symbol: string): Promise<{ formType: string; filedAt: string; url?: string } | null> {
    const filing = await this.detectRecentEvent(symbol);
    
    if (!filing) {
      return null;
    }

    return {
      formType: filing.type,
      filedAt: filing.filingDate.toISOString(),
      url: filing.url,
    };
  }
}

// 싱글톤 인스턴스
export const secMonitor = new SecMonitor();

