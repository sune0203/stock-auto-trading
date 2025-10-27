// Financial Modeling Prep API 클라이언트
import axios from 'axios'

const FMP_API_KEY = 'Nz122fIiH3KWDx8UVBdQFL8a5NU9lRhc'
const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3'

interface CompanyProfile {
  symbol: string
  companyName: string
  price: number
  exchange: string
  exchangeShortName: string
  industry: string
  sector: string
  isActivelyTrading: boolean
}

interface StockQuote {
  symbol: string
  price: number
  changesPercentage: number
  change: number
  dayLow: number
  dayHigh: number
  volume: number
  marketCap: number
  exchange: string
}

interface HistoricalPrice {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface IntradayPrice {
  date: string
  minute: string
  label: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export class FMPApi {
  /**
   * 회사명으로 심볼 검색 (FMP Name Search API) - 정확도 개선
   */
  async searchByName(query: string): Promise<any[]> {
    try {
      // 1단계: Name Search API (회사명 정확 검색)
      const nameUrl = `${FMP_BASE_URL}/search-name?query=${encodeURIComponent(query)}&apikey=${FMP_API_KEY}`
      const nameResponse = await axios.get(nameUrl, { timeout: 10000 })
      
      console.log(`🔍 FMP 회사명 검색: "${query}"`)
      console.log(`   Name Search 결과: ${nameResponse.data.length}개`)
      
      // 나스닥만 필터링 및 정확도 점수 계산
      const nasdaqResults = nameResponse.data
        .filter((item: any) => {
          const exchange = item.exchangeShortName || item.stockExchange
          return exchange === 'NASDAQ' || exchange === 'NMS' || exchange === 'NGM' || exchange === 'NCM'
        })
        .map((item: any) => {
          // 회사명 매칭 점수 계산 (정확도)
          const companyName = (item.name || item.companyName || '').toLowerCase()
          const queryLower = query.toLowerCase()
          
          let score = 0
          
          // 완전 일치
          if (companyName === queryLower) {
            score = 100
          }
          // 시작 일치
          else if (companyName.startsWith(queryLower)) {
            score = 90
          }
          // 포함 (단어 경계)
          else if (new RegExp(`\\b${queryLower}\\b`).test(companyName)) {
            score = 80
          }
          // 포함 (일반)
          else if (companyName.includes(queryLower)) {
            score = 70
          }
          // 부분 일치 (각 단어)
          else {
            const queryWords = queryLower.split(/\s+/)
            const matchedWords = queryWords.filter(word => companyName.includes(word))
            score = (matchedWords.length / queryWords.length) * 60
          }
          
          return { ...item, matchScore: score }
        })
        .filter(item => item.matchScore >= 60) // 60점 이상만
        .sort((a, b) => b.matchScore - a.matchScore) // 점수 높은 순
      
      if (nasdaqResults.length > 0) {
        console.log(`   ✓ 나스닥 종목 발견:`)
        nasdaqResults.slice(0, 3).forEach(item => {
          console.log(`      ${item.symbol} - ${item.name || item.companyName} (점수: ${item.matchScore})`)
        })
      } else {
        console.log(`   ✗ 나스닥 종목 없음`)
      }
      
      return nasdaqResults
    } catch (error: any) {
      console.error('FMP name search error:', error.message)
      return []
    }
  }

  /**
   * 티커 심볼 검색 (Symbol Search API)
   */
  async searchSymbol(query: string): Promise<any[]> {
    try {
      const url = `${FMP_BASE_URL}/search?query=${encodeURIComponent(query)}&apikey=${FMP_API_KEY}`
      const response = await axios.get(url, { timeout: 10000 })
      
      // 나스닥만 필터링
      const nasdaqResults = response.data.filter((item: any) => {
        const exchange = item.exchangeShortName || item.stockExchange
        return exchange === 'NASDAQ' || exchange === 'NMS' || exchange === 'NGM' || exchange === 'NCM'
      })
      
      return nasdaqResults
    } catch (error: any) {
      console.error('FMP symbol search error:', error.message)
      return []
    }
  }

  /**
   * 티커 검증 (정확한 티커인지 확인)
   */
  async validateSymbol(symbol: string): Promise<{ valid: boolean; profile: any | null }> {
    try {
      // 1. Profile API로 티커 존재 여부 확인
      const profile = await this.getCompanyProfile(symbol)
      
      if (!profile) {
        console.log(`   ✗ "${symbol}" 는 유효하지 않거나 나스닥이 아님`)
        return { valid: false, profile: null }
      }
      
      // 2. 활성 거래 중인지 확인
      if (!profile.isActivelyTrading) {
        console.log(`   ✗ "${symbol}" 는 거래 중단됨`)
        return { valid: false, profile: null }
      }
      
      console.log(`   ✓ "${symbol}" 검증 성공: ${profile.companyName}`)
      return { valid: true, profile }
    } catch (error: any) {
      console.error(`티커 검증 실패 ${symbol}:`, error.message)
      return { valid: false, profile: null }
    }
  }

  /**
   * 티커의 회사 프로필 조회
   */
  async getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
    try {
      const url = `${FMP_BASE_URL}/profile/${symbol}?apikey=${FMP_API_KEY}`
      const response = await axios.get(url, { timeout: 10000 })
      
      if (response.data && response.data.length > 0) {
        const profile = response.data[0]
        
        // 나스닥 거래소인지 확인
        const isNasdaq = profile.exchangeShortName === 'NASDAQ' || 
                        profile.exchangeShortName === 'NMS'
        
        if (!isNasdaq) {
          return null
        }
        
        return {
          symbol: profile.symbol,
          companyName: profile.companyName,
          price: profile.price,
          exchange: profile.exchange,
          exchangeShortName: profile.exchangeShortName,
          industry: profile.industry,
          sector: profile.sector,
          isActivelyTrading: profile.isActivelyTrading
        }
      }
      
      return null
    } catch (error) {
      console.error(`FMP profile error for ${symbol}:`, error)
      return null
    }
  }

  /**
   * 실시간 주가 조회 (단일)
   */
  async getQuote(symbol: string): Promise<StockQuote | null> {
    try {
      const url = `${FMP_BASE_URL}/quote/${symbol}?apikey=${FMP_API_KEY}`
      const response = await axios.get(url, { timeout: 10000 })
      
      if (response.data && response.data.length > 0) {
        const quote = response.data[0]
        return {
          symbol: quote.symbol,
          price: quote.price,
          changesPercentage: quote.changesPercentage,
          change: quote.change,
          dayLow: quote.dayLow,
          dayHigh: quote.dayHigh,
          volume: quote.volume,
          marketCap: quote.marketCap,
          exchange: quote.exchange
        }
      }
      
      return null
    } catch (error) {
      console.error(`FMP quote error for ${symbol}:`, error)
      return null
    }
  }

  /**
   * 실시간 주가 조회 (다중) - 여러 종목 한번에
   */
  async getQuotes(symbols: string[]): Promise<StockQuote[]> {
    try {
      if (symbols.length === 0) return []

      // FMP는 쉼표로 구분된 심볼 지원
      const symbolsParam = symbols.join(',')
      const url = `${FMP_BASE_URL}/quote/${symbolsParam}?apikey=${FMP_API_KEY}`
      const response = await axios.get(url, { timeout: 15000 })
      
      if (response.data && Array.isArray(response.data)) {
        return response.data.map((quote: any) => ({
          symbol: quote.symbol,
          price: quote.price,
          changesPercentage: quote.changesPercentage,
          change: quote.change,
          dayLow: quote.dayLow,
          dayHigh: quote.dayHigh,
          volume: quote.volume,
          marketCap: quote.marketCap,
          exchange: quote.exchange
        }))
      }
      
      return []
    } catch (error) {
      console.error(`FMP quotes error:`, error)
      return []
    }
  }

  /**
   * 티커가 나스닥에 상장되어 있는지 확인
   */
  async isNasdaqListed(symbol: string): Promise<boolean> {
    const profile = await this.getCompanyProfile(symbol)
    return profile !== null && profile.isActivelyTrading
  }

  /**
   * 뉴스 텍스트에서 회사명으로 티커 찾기
   */
  async findTickerFromText(text: string): Promise<string | null> {
    // 텍스트에서 가능한 회사명 추출
    const possibleCompanies = this.extractCompanyNames(text)
    
    for (const companyName of possibleCompanies) {
      const results = await this.searchSymbol(companyName)
      
      if (results.length > 0) {
        // 가장 관련성 높은 결과 (첫 번째) 반환
        const topResult = results[0]
        console.log(`✓ Found ticker: ${topResult.symbol} for "${companyName}"`)
        return topResult.symbol
      }
    }
    
    return null
  }

  /**
   * 텍스트에서 회사명 추출 (간단한 휴리스틱)
   */
  private extractCompanyNames(text: string): string[] {
    const names: string[] = []
    
    // 대문자로 시작하는 단어들 (2-4 단어)
    const regex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g
    let match
    
    while ((match = regex.exec(text)) !== null) {
      const name = match[1]
      // 일반적인 단어 제외
      if (!['The', 'This', 'That', 'These', 'Those', 'October', 'November'].includes(name)) {
        names.push(name)
      }
    }
    
    return names.slice(0, 5) // 최대 5개만
  }

  /**
   * 일별 히스토리컬 데이터 조회 (최대 1년)
   */
  async getHistoricalPrices(ticker: string, days: number = 30): Promise<HistoricalPrice[]> {
    try {
      // 조정되지 않은 실제 가격 사용 (스플릿 반영 안 함)
      const url = `${FMP_BASE_URL}/historical-price-full/${ticker}?apikey=${FMP_API_KEY}`
      const response = await axios.get(url, { timeout: 10000 })
      
      if (response.data?.historical) {
        const data = response.data.historical.slice(0, days)
        console.log(`📊 FMP Historical API 응답 (${ticker}):`, data.length, '개')
        if (data.length > 0) {
          console.log('   최신 데이터:', data[0])
        }
        return data
      }
      return []
    } catch (error) {
      console.error(`히스토리컬 데이터 조회 실패 ${ticker}:`, error)
      return []
    }
  }

  /**
   * 실시간 인트라데이 데이터 조회 (FMP Stable API - 유료 플랜)
   */
  async getIntradayPrices(ticker: string, interval: string = '5min'): Promise<IntradayPrice[]> {
    try {
      // interval: '1min', '3min' (X), '5min', '15min', '30min', '1hour', '4hour'
      // FMP는 3분봉을 지원하지 않으므로 15분봉으로 대체
      const apiInterval = interval === '3min' ? '15min' : interval
      
      // FMP Stable API 엔드포인트 (유료 플랜 - 실시간 데이터)
      const url = `https://financialmodelingprep.com/stable/historical-chart/${apiInterval}?symbol=${ticker}&apikey=${FMP_API_KEY}`
      const response = await axios.get(url, { timeout: 15000 })
      
      if (Array.isArray(response.data)) {
        console.log(`📊 FMP 실시간 ${apiInterval} 데이터 (${ticker}):`, response.data.length, '개')
        if (response.data.length > 0) {
          console.log(`   최신: ${response.data[0].date} - $${response.data[0].close}`)
        }
        
        // 데이터 제한 (성능 고려)
        // 1분봉: 최대 5일치 (1950개)
        // 5분봉: 최대 30일치 (2340개)
        // 15분봉: 최대 90일치 (3600개)
        const limit = interval === '1min' ? 1950
                    : interval === '5min' ? 2340
                    : interval === '15min' ? 3600
                    : interval === '30min' ? 4800
                    : interval === '1hour' ? 7200
                    : 2000
        
        return response.data.slice(0, limit)
      }
      return []
    } catch (error: any) {
      // 에러 발생 시 구버전 API로 폴백
      console.log(`⚠️ Stable API 실패, 구버전 API로 폴백: ${ticker}`)
      try {
        const fallbackUrl = `${FMP_BASE_URL}/historical-chart/${interval}/${ticker}?apikey=${FMP_API_KEY}`
        const fallbackResponse = await axios.get(fallbackUrl, { timeout: 10000 })
        if (Array.isArray(fallbackResponse.data)) {
          return fallbackResponse.data.slice(0, 2000)
        }
      } catch (fallbackError) {
        console.error(`인트라데이 데이터 조회 완전 실패 ${ticker}:`, fallbackError)
      }
      return []
    }
  }

  /**
   * 여러 티커 검증 (배치)
   */
  async validateTickers(symbols: string[]): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}
    
    // 병렬로 검증 (최대 5개씩)
    const chunks = []
    for (let i = 0; i < symbols.length; i += 5) {
      chunks.push(symbols.slice(i, i + 5))
    }
    
    for (const chunk of chunks) {
      const promises = chunk.map(async (symbol) => {
        const isValid = await this.isNasdaqListed(symbol)
        results[symbol] = isValid
      })
      
      await Promise.all(promises)
    }
    
    return results
  }

  /**
   * 현재가 조회 (KIS API 대체/보조용)
   */
  async getCurrentPrice(symbol: string): Promise<number | null> {
    const quote = await this.getQuote(symbol)
    return quote ? quote.price : null
  }
}

