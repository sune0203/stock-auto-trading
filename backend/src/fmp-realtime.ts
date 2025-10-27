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
}

export const fmpRealTimeApi = new FMPRealTimeApi()

