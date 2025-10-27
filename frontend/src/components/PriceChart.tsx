import { useEffect, useRef, useState } from 'react'
import { createChart, IChartApi, ISeriesApi, Time } from 'lightweight-charts'
import './PriceChart.css'

interface PriceChartProps {
  ticker: string
  timeframe: '5min' | 'daily'
}

interface HistoricalData {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface IntradayData {
  date: string
  minute: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function PriceChart({ ticker, timeframe }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!chartContainerRef.current) return

    // 차트 생성
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { color: '#1a1a2e' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2a2e39' },
        horzLines: { color: '#2a2e39' },
      },
      timeScale: {
        borderColor: '#485c7b',
        timeVisible: timeframe === '5min',
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: '#485c7b',
      },
    })

    chartRef.current = chart

    // 캔들스틱 시리즈 추가
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    candleSeriesRef.current = candleSeries

    // 볼륨 시리즈 추가
    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    })
    volumeSeriesRef.current = volumeSeries

    // 차트 리사이즈 핸들러
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        })
      }
    }

    window.addEventListener('resize', handleResize)

    // 데이터 로드
    loadChartData()

    return () => {
      window.removeEventListener('resize', handleResize)
      if (chartRef.current) {
        chartRef.current.remove()
      }
    }
  }, [ticker, timeframe])

  const loadChartData = async () => {
    setLoading(true)
    setError(null)

    try {
      let url: string
      if (timeframe === '5min') {
        url = `http://localhost:3001/api/chart/intraday/${ticker}`
      } else {
        url = `http://localhost:3001/api/chart/historical/${ticker}?days=30`
      }

      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('차트 데이터 로드 실패')
      }

      const data = await response.json()

      if (!candleSeriesRef.current || !volumeSeriesRef.current) return

      // 데이터 변환
      const candleData: any[] = []
      const volumeData: any[] = []

      if (timeframe === '5min') {
        // 인트라데이 데이터
        data.reverse().forEach((item: IntradayData) => {
          const timestamp = new Date(`${item.date} ${item.minute}`).getTime() / 1000
          candleData.push({
            time: timestamp as Time,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
          })
          volumeData.push({
            time: timestamp as Time,
            value: item.volume,
            color: item.close >= item.open ? '#26a69a80' : '#ef535080',
          })
        })
      } else {
        // 일별 데이터
        data.reverse().forEach((item: HistoricalData) => {
          candleData.push({
            time: item.date as Time,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
          })
          volumeData.push({
            time: item.date as Time,
            value: item.volume,
            color: item.close >= item.open ? '#26a69a80' : '#ef535080',
          })
        })
      }

      candleSeriesRef.current.setData(candleData)
      volumeSeriesRef.current.setData(volumeData)

      // 차트 자동 스케일 조정
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent()
      }

      setLoading(false)
    } catch (err) {
      console.error('차트 데이터 로드 오류:', err)
      setError('차트를 불러올 수 없습니다')
      setLoading(false)
    }
  }

  return (
    <div className="price-chart-container">
      <div className="chart-header">
        <h3>{ticker} 가격 차트</h3>
        <span className="chart-timeframe">
          {timeframe === '5min' ? '5분봉 (실시간)' : '일봉 (30일)'}
        </span>
      </div>
      
      {loading && <div className="chart-loading">차트 로딩 중...</div>}
      {error && <div className="chart-error">{error}</div>}
      
      <div ref={chartContainerRef} className="chart-wrapper" />
    </div>
  )
}

export default PriceChart

