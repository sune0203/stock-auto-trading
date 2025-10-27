import mysql from 'mysql2/promise'
import 'dotenv/config'
import { FMPApi } from './fmp-api.js'

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'nasdaq',
  password: process.env.DB_PASS || 'core1601!',
  database: process.env.DB_NAME || 'nasdaq',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
})

interface CachedCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export class ChartCacheService {
  private fmpApi: FMPApi

  constructor() {
    this.fmpApi = new FMPApi()
  }

  /**
   * 캐시된 차트 데이터 조회 (없으면 API 호출 후 저장)
   */
  async getChartData(ticker: string, interval: string, days: number = 180): Promise<CachedCandle[]> {
    try {
      // 1. DB에서 캐시 조회
      const cached = await this.getCachedData(ticker, interval, days)
      
      // 2. 캐시가 충분하면 반환
      const now = new Date()
      const oldestRequired = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
      
      if (cached.length > 0) {
        const oldestCached = new Date(cached[0].date)
        
        // 캐시가 충분히 오래되었고, 최근 데이터도 있으면 캐시 사용
        if (oldestCached <= oldestRequired) {
          console.log(`📊 캐시 사용: ${ticker} ${interval} (${cached.length}개)`)
          return cached
        }
      }
      
      // 3. 캐시가 부족하면 API 호출
      console.log(`🔄 API 호출: ${ticker} ${interval}`)
      const apiData = await this.fetchFromAPI(ticker, interval, days)
      
      // 4. DB에 저장
      if (apiData.length > 0) {
        await this.saveToCache(ticker, interval, apiData)
      }
      
      return apiData
    } catch (error) {
      console.error(`차트 캐시 조회 실패 ${ticker}:`, error)
      // 에러 시 API 직접 호출
      return await this.fetchFromAPI(ticker, interval, days)
    }
  }

  /**
   * DB에서 캐시 조회
   */
  private async getCachedData(ticker: string, interval: string, days: number): Promise<CachedCandle[]> {
    const [rows] = await pool.query(
      `SELECT c_date as date, c_open as open, c_high as high, c_low as low, c_close as close, c_volume as volume
       FROM _CHART_CACHE
       WHERE c_ticker = ? AND c_interval = ? AND c_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY c_date ASC`,
      [ticker, interval, days]
    )
    
    return (rows as any[]).map(row => ({
      date: row.date,
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: row.volume ? parseInt(row.volume) : undefined
    }))
  }

  /**
   * FMP API에서 데이터 가져오기
   */
  private async fetchFromAPI(ticker: string, interval: string, days: number): Promise<CachedCandle[]> {
    let data: CachedCandle[] = []
    
    if (interval === '1min' || interval === '5min' || interval === '15min' || interval === '30min' || interval === '1hour') {
      // 인트라데이 데이터
      data = await this.fmpApi.getIntradayPrices(ticker, interval)
      console.log(`📥 FMP 인트라데이  데이터 (${ticker} ${interval}): ${data.length}개`)
      if (data.length > 0) {
        console.log('   첫 데이터:', data[0])
        console.log('   마지막 데이터:', data[data.length - 1])
      }
    } else {
      // 일봉 데이터
      data = await this.fmpApi.getHistoricalPrices(ticker, days)
      console.log(`📥 FMP 히스토리컬 데이터 (${ticker}): ${data.length}개`)
      if (data.length > 0) {
        console.log('   첫 데이터:', data[0])
        console.log('   마지막 데이터:', data[data.length - 1])
      }
    }
    
    return data
  }

  /**
   * DB에 캐시 저장 (UPSERT)
   */
  private async saveToCache(ticker: string, interval: string, data: CachedCandle[]): Promise<void> {
    if (data.length === 0) return

    try {
      const values = data.map(candle => [
        ticker,
        interval,
        candle.date,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume || null
      ])

      // UPSERT (중복 시 업데이트)
      await pool.query(
        `INSERT INTO _CHART_CACHE 
         (c_ticker, c_interval, c_date, c_open, c_high, c_low, c_close, c_volume)
         VALUES ?
         ON DUPLICATE KEY UPDATE
         c_open = VALUES(c_open),
         c_high = VALUES(c_high),
         c_low = VALUES(c_low),
         c_close = VALUES(c_close),
         c_volume = VALUES(c_volume)`,
        [values]
      )

      console.log(`💾 캐시 저장: ${ticker} ${interval} (${data.length}개)`)
    } catch (error) {
      console.error(`캐시 저장 실패 ${ticker}:`, error)
    }
  }

  /**
   * 오래된 캐시 정리
   */
  async cleanOldCache(): Promise<void> {
    try {
      // 1분봉: 7일 이상 삭제
      await pool.query(
        `DELETE FROM _CHART_CACHE WHERE c_interval = '1min' AND c_date < DATE_SUB(NOW(), INTERVAL 7 DAY)`
      )
      
      // 5분봉: 30일 이상 삭제
      await pool.query(
        `DELETE FROM _CHART_CACHE WHERE c_interval = '5min' AND c_date < DATE_SUB(NOW(), INTERVAL 30 DAY)`
      )
      
      // 일봉: 3년 이상 삭제
      await pool.query(
        `DELETE FROM _CHART_CACHE WHERE c_interval = '1day' AND c_date < DATE_SUB(NOW(), INTERVAL 3 YEAR)`
      )
      
      console.log('🧹 오래된 캐시 정리 완료')
    } catch (error) {
      console.error('캐시 정리 실패:', error)
    }
  }
}

export const chartCacheService = new ChartCacheService()

