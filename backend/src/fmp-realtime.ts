// FMP 실시간 가격 API
import axios from 'axios'

const FMP_API_KEY = process.env.FMP_API_KEY || 'Nz122fIiH3KWDx8UVBdQFL8a5NU9lRhc'
const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3'

export interface RealTimeQuote {
  symbol: string
  price: number
  changesPercentage: number
  change: number
  dayLow: number
  dayHigh: number
  yearHigh: number
  yearLow: number
  marketCap: number
  priceAvg50: number
  priceAvg200: number
  volume: number
  avgVolume: number
  open: number
  previousClose: number
  eps: number
  pe: number
  earningsAnnouncement: string
  sharesOutstanding: number
  timestamp: number
}

export class FMPRealTimeApi {
  // 실시간 시세 조회 (Quote API)
  async getQuote(symbol: string): Promise<RealTimeQuote | null> {
    try {
      const response = await axios.get(`${FMP_BASE_URL}/quote/${symbol}`, {
        params: { apikey: FMP_API_KEY }
      })
      
      if (response.data && response.data.length > 0) {
        const quote = response.data[0]
        return quote
      }
      
      return null
    } catch (error: any) {
      console.error(`❌ FMP Quote API 오류 (${symbol}):`, error.response?.data || error.message)
      return null
    }
  }

  // 여러 종목 동시 조회
  async getQuotes(symbols: string[]): Promise<RealTimeQuote[]> {
    try {
      const symbolsParam = symbols.join(',')
      const response = await axios.get(`${FMP_BASE_URL}/quote/${symbolsParam}`, {
        params: { apikey: FMP_API_KEY }
      })
      
      return response.data || []
    } catch (error) {
      console.error(`FMP Quotes API 오류:`, error)
      return []
    }
  }

  // 실시간 가격만 빠르게 조회 (Full Quote API)
  async getFullQuote(symbol: string): Promise<any> {
    try {
      const response = await axios.get(`${FMP_BASE_URL}/quote-short/${symbol}`, {
        params: { apikey: FMP_API_KEY }
      })
      
      if (response.data && response.data.length > 0) {
        return response.data[0]
      }
      return null
    } catch (error) {
      console.error(`FMP Full Quote API 오류 (${symbol}):`, error)
      return null
    }
  }

  // 실시간 가격 스트리밍 (폴링 방식)
  startPriceStreaming(
    symbols: string[],
    callback: (quotes: RealTimeQuote[]) => void,
    interval: number = 5000 // 5초마다
  ): NodeJS.Timeout {
    const fetchPrices = async () => {
      const quotes = await this.getQuotes(symbols)
      if (quotes.length > 0) {
        callback(quotes)
      }
    }

    // 즉시 한 번 실행
    fetchPrices()

    // 주기적으로 실행
    return setInterval(fetchPrices, interval)
  }

  // 스트리밍 중지
  stopPriceStreaming(intervalId: NodeJS.Timeout) {
    clearInterval(intervalId)
  }

  /**
   * 배치 애프터마켓 가격 조회 (여러 종목 동시 조회)
   * 
   * @param symbols 종목 코드 배열
   * @returns { symbol: price } 맵 (가격 조회 실패 시 null)
   */
  async getBatchAftermarketPrices(symbols: string[]): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>()
    
    if (symbols.length === 0) return result
    
    try {
      // 배치 애프터마켓 거래 가격 조회
      const batchUrl = `https://financialmodelingprep.com/stable/batch-aftermarket-trade`
      const symbolsParam = symbols.join(',')
      
      const response = await axios.get(batchUrl, {
        params: { 
          symbols: symbolsParam,
          apikey: FMP_API_KEY 
        },
        timeout: 10000
      })
      
      if (response.data && Array.isArray(response.data)) {
        // 응답 데이터를 맵으로 변환
        const prices = response.data.map((t: any) => `${t.symbol}=$${t.price}`).join(', ')
        console.log(`🌙 [FMP Batch Aftermarket] ${prices}`)
        
        response.data.forEach((trade: any) => {
          if (trade.symbol && trade.price && trade.price > 0) {
            result.set(trade.symbol, trade.price)
          }
        })
      }
      
      // 애프터마켓에서 조회 실패한 종목은 정규장 Quote API로 fallback
      const missingSymbols = symbols.filter(s => !result.has(s))
      
      if (missingSymbols.length > 0) {
        const quoteUrl = `${FMP_BASE_URL}/quote/${missingSymbols.join(',')}`
        const quoteResponse = await axios.get(quoteUrl, {
          params: { apikey: FMP_API_KEY },
          timeout: 5000
        })
        
        if (quoteResponse.data && Array.isArray(quoteResponse.data)) {
          const quotePrices = quoteResponse.data.map((q: any) => `${q.symbol}=$${q.price}`).join(', ')
          console.log(`💵 [FMP Batch Quote] ${quotePrices}`)
          
          quoteResponse.data.forEach((quote: any) => {
            if (quote.symbol && quote.price && quote.price > 0) {
              result.set(quote.symbol, quote.price)
            }
          })
        }
      }
      
      // 여전히 조회 실패한 종목은 null 설정
      symbols.forEach(symbol => {
        if (!result.has(symbol)) {
          result.set(symbol, null)
          console.warn(`⚠️ [FMP] ${symbol} 가격 조회 실패`)
        }
      })
      
      return result
    } catch (error: any) {
      console.error('❌ FMP 배치 가격 조회 오류:', error.message)
      // 오류 발생 시 모든 종목에 null 설정
      symbols.forEach(symbol => result.set(symbol, null))
      return result
    }
  }

  /**
   * 🔥 실시간 가격 조회 (정규장 + 시간외 거래)
   * - 애프터마켓: /stable/aftermarket-trade API (우선)
   * - 정규장: /quote API (폴백)
   */
  async getCurrentPrice(symbol: string): Promise<number | null> {
    try {
      // 1. 애프터마켓 거래 가격 우선 조회 (Stable API 사용)
      const aftermarketUrl = `https://financialmodelingprep.com/stable/aftermarket-trade`
      const aftermarketResponse = await axios.get(aftermarketUrl, {
        params: { 
          symbol: symbol,
          apikey: FMP_API_KEY 
        },
        timeout: 5000
      })
      
      if (aftermarketResponse.data && aftermarketResponse.data.length > 0) {
        const trade = aftermarketResponse.data[0]
        const price = trade.price
        const timestamp = trade.timestamp
        const tradeDate = new Date(timestamp)
        
        // 타임스탬프가 있고 가격이 유효하면 사용
        if (price && price > 0) {
          console.log(`🌙 [FMP Aftermarket] ${symbol} = $${price} (거래시간: ${tradeDate.toLocaleString('ko-KR')})`)
          return price
        }
      }
      
      // 2. 정규장 시세 조회 (애프터마켓 데이터가 없을 때)
      const quoteUrl = `${FMP_BASE_URL}/quote/${symbol}`
      const quoteResponse = await axios.get(quoteUrl, {
        params: { apikey: FMP_API_KEY },
        timeout: 5000
      })
      
      if (quoteResponse.data && quoteResponse.data.length > 0) {
        const quote = quoteResponse.data[0]
        const price = quote.price
        
        if (price && price > 0) {
          console.log(`💵 [FMP Quote] ${symbol} = $${price}`)
          return price
        }
      }
      
      // 가격 조회 실패
      return null
    } catch (error: any) {
      console.error(`❌ FMP 가격 조회 오류: ${symbol}`, error.message)
      return null
    }
  }
}

export const fmpRealTimeApi = new FMPRealTimeApi()

