import React, { useEffect, useRef, useState } from 'react'
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts'
import axios from 'axios'
import './TradingChart.css'

interface TradingChartProps {
  symbol: string
}

const TradingChart: React.FC<TradingChartProps> = ({ symbol }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const [timeframe, setTimeframe] = useState<'1M' | '3M' | '5M' | '1D' | '1W'>('1D')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!chartContainerRef.current) return

    // 차트 생성 (v4 API)
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        backgroundColor: '#ffffff',
        textColor: '#191f28',
        fontSize: 12,
      },
      grid: {
        vertLines: { 
          color: '#e9ecef',
          visible: true,
        },
        horzLines: { 
          color: '#e9ecef',
          visible: true,
        },
      },
      crosshair: {
        mode: 0, // CrosshairMode.Normal
        vertLine: {
          width: 1,
          color: '#758696',
          style: 0, // LineStyle.Solid
          labelVisible: true,
          labelBackgroundColor: '#4c6ef5',
        },
        horzLine: {
          width: 1,
          color: '#758696',
          style: 0, // LineStyle.Solid
          labelVisible: true,
          labelBackgroundColor: '#4c6ef5',
        },
      },
      rightPriceScale: {
        borderColor: '#dee2e6',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
        autoScale: true,
        visible: true,
        borderVisible: true,
      },
      timeScale: {
        borderColor: '#dee2e6',
        timeVisible: true,
        secondsVisible: false,
        visible: true,
        fixLeftEdge: false,
        fixRightEdge: false,
        borderVisible: true,
        rightOffset: 12,
        barSpacing: 12,
        minBarSpacing: 0.5,
      },
    })

    chartRef.current = chart

    // 캔들스틱 시리즈 추가 (v4 API)
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#f03e3e',
      downColor: '#1971c2',
      borderVisible: false,
      wickUpColor: '#f03e3e',
      wickDownColor: '#1971c2',
    })

    candlestickSeriesRef.current = candlestickSeries

    // 리사이즈 핸들러
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        const width = chartContainerRef.current.clientWidth
        const height = chartContainerRef.current.clientHeight
        
        if (width > 0 && height > 0) {
          chartRef.current.applyOptions({ width, height })
          chartRef.current.timeScale().fitContent()
        }
      }
    }

    // 초기 리사이즈
    setTimeout(() => handleResize(), 100)

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

  useEffect(() => {
    loadChartData()
  }, [symbol, timeframe])

  const loadChartData = async () => {
    if (!candlestickSeriesRef.current) return

    setLoading(true)
    try {
      let endpoint = ''
      
      // 분봉은 인트라데이 데이터 사용 (FMP는 1min, 5min, 15min, 30min, 1hour 지원)
      if (timeframe === '1M') {
        endpoint = `http://localhost:3001/api/chart/intraday/${symbol}?interval=1min`
      } else if (timeframe === '3M') {
        // 3분봉은 FMP에서 지원하지 않으므로 15분봉 사용 (더 명확한 구분)
        endpoint = `http://localhost:3001/api/chart/intraday/${symbol}?interval=15min`
      } else if (timeframe === '5M') {
        endpoint = `http://localhost:3001/api/chart/intraday/${symbol}?interval=5min`
      } else {
        // 일봉 데이터 (6개월 = 180일)
        const days = timeframe === '1D' ? 180 : timeframe === '1W' ? 180 : 180
        endpoint = `http://localhost:3001/api/chart/historical/${symbol}?days=${days}`
      }
      
      const response = await axios.get(endpoint)
      
      console.log(`📊 차트 데이터 수신 (${timeframe}):`, response.data?.length, '개')
      if (response.data?.length > 0) {
        console.log('   첫 데이터:', response.data[0])
        console.log('   마지막 데이터:', response.data[response.data.length - 1])
      }

      // 데이터 형식 변환
      const data = response.data.map((item: any) => {
        // 분봉: timestamp 사용, 일봉: "yyyy-mm-dd" 사용
        const isIntraday = timeframe === '1M' || timeframe === '3M' || timeframe === '5M'
        
        let timeValue
        if (isIntraday) {
          // 분봉: timestamp (초 단위)
          const date = new Date(item.date)
          timeValue = Math.floor(date.getTime() / 1000)
        } else {
          // 일봉: "YYYY-MM-DD" 형식
          timeValue = item.date.split(' ')[0] // "2025-10-22 14:30" -> "2025-10-22"
        }
        
        return {
          time: timeValue,
          open: parseFloat(item.open) || 0,
          high: parseFloat(item.high) || 0,
          low: parseFloat(item.low) || 0,
          close: parseFloat(item.close) || 0,
        }
      })
      
      console.log('📈 변환된 차트 데이터:')
      if (data.length > 0) {
        console.log('   첫 데이터:', data[0])
        console.log('   마지막 데이터:', data[data.length - 1])
      }

      if (data.length > 0) {
        // 정렬 (과거 → 현재)
        const isIntraday = timeframe === '1M' || timeframe === '3M' || timeframe === '5M'
        if (isIntraday) {
          // timestamp 정렬
          data.sort((a: any, b: any) => a.time - b.time)
        } else {
          // 날짜 문자열 정렬
          data.sort((a: any, b: any) => a.time.localeCompare(b.time))
        }
        
        candlestickSeriesRef.current.setData(data)
        
        // 차트 시간축 표시 및 자동 맞춤
        if (chartRef.current) {
          chartRef.current.timeScale().fitContent()
        }
      }
    } catch (error) {
      console.error('차트 데이터 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="trading-chart">
      <div className="chart-header">
        <div className="chart-timeframes">
          {(['1M', '3M', '5M', '1D', '1W'] as const).map((tf) => (
            <button
              key={tf}
              className={`timeframe-btn ${timeframe === tf ? 'active' : ''}`}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
        {loading && <div className="chart-loading">로딩 중...</div>}
      </div>
      <div ref={chartContainerRef} className="chart-content" />
    </div>
  )
}

export default TradingChart

