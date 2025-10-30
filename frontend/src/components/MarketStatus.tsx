import React, { useState, useEffect } from 'react'
import './MarketStatus.css'

type MarketPhase = 'pre-market' | 'regular' | 'after-market' | 'after-extended' | 'day-market' | 'weekend'

interface MarketStatusState {
  phase: MarketPhase
  isSummerTime: boolean
  statusLabel: string
  timeInfo: string
  hasRealTimeData: boolean
}

const MarketStatus: React.FC = () => {
  const [status, setStatus] = useState<MarketStatusState>({
    phase: 'day-market',
    isSummerTime: false,
    statusLabel: '주간거래',
    timeInfo: '',
    hasRealTimeData: false
  })

  // Summer Time 체크 함수 (3월 두번째 일요일 ~ 11월 첫번째 일요일)
  const isSummerTime = (date: Date): boolean => {
    const year = date.getFullYear()
    const month = date.getMonth() // 0-11
    
    // 3월 이전 또는 11월 이후면 동절기
    if (month < 2 || month > 10) return false
    if (month > 2 && month < 10) return true
    
    // 3월이나 11월인 경우 정확한 일요일 계산
    const day = date.getDate()
    const dayOfWeek = date.getDay()
    
    if (month === 2) { // 3월
      // 두번째 일요일 찾기
      const secondSunday = 8 + (7 - new Date(year, 2, 8).getDay())
      return day >= secondSunday
    } else { // 11월
      // 첫번째 일요일 찾기
      const firstSunday = 1 + (7 - new Date(year, 10, 1).getDay())
      return day < firstSunday
    }
  }

  useEffect(() => {
    const updateMarketStatus = () => {
      const now = new Date()
      const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const day = nyTime.getDay() // 0=일요일, 6=토요일
      const hours = nyTime.getHours()
      const minutes = nyTime.getMinutes()
      const currentMinutes = hours * 60 + minutes
      const isSummer = isSummerTime(nyTime)

      // 주말 체크
      if (day === 0 || day === 6) {
        const daysUntilMonday = day === 0 ? 1 : 2
        const nextMonday = new Date(nyTime)
        nextMonday.setDate(nextMonday.getDate() + daysUntilMonday)
        nextMonday.setHours(9, 30, 0, 0)
        
        const diff = nextMonday.getTime() - nyTime.getTime()
        const daysLeft = Math.floor(diff / (1000 * 60 * 60 * 24))
        const hoursLeft = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        
        setStatus({
          phase: 'weekend',
          isSummerTime: isSummer,
          statusLabel: '주말 휴장',
          timeInfo: `월요일 오픈까지 ${daysLeft}일 ${hoursLeft}시간`,
          hasRealTimeData: false
        })
        return
      }

      // 시장 시간대 구분
      const preMarketStart = 4 * 60      // 04:00 (EST)
      const regularStart = 9 * 60 + 30   // 09:30 (EST)
      const regularEnd = 16 * 60         // 16:00 (EST)
      const afterMarketEnd = 17 * 60     // 17:00 (EST)
      const afterExtendedEnd = 19 * 60   // 19:00 (EST)

      let nextChangeTime: Date
      let phase: MarketPhase
      let statusLabel: string
      let hasRealTimeData: boolean

      if (currentMinutes >= preMarketStart && currentMinutes < regularStart) {
        // 프리마켓 (04:00 ~ 09:30)
        phase = 'pre-market'
        statusLabel = isSummer ? '프리마켓 (Summer)' : '프리마켓'
        hasRealTimeData = true
        nextChangeTime = new Date(nyTime)
        nextChangeTime.setHours(9, 30, 0, 0)
      } else if (currentMinutes >= regularStart && currentMinutes < regularEnd) {
        // 정규장 (09:30 ~ 16:00)
        phase = 'regular'
        statusLabel = '정규장'
        hasRealTimeData = true
        nextChangeTime = new Date(nyTime)
        nextChangeTime.setHours(16, 0, 0, 0)
      } else if (currentMinutes >= regularEnd && currentMinutes < afterMarketEnd) {
        // 애프터마켓 (16:00 ~ 17:00)
        phase = 'after-market'
        statusLabel = isSummer ? '애프터마켓 (Summer)' : '애프터마켓'
        hasRealTimeData = true
        nextChangeTime = new Date(nyTime)
        nextChangeTime.setHours(17, 0, 0, 0)
      } else if (currentMinutes >= afterMarketEnd && currentMinutes < afterExtendedEnd) {
        // 애프터마켓 연장 (17:00 ~ 19:00)
        phase = 'after-extended'
        statusLabel = '애프터마켓 연장'
        hasRealTimeData = true
        nextChangeTime = new Date(nyTime)
        nextChangeTime.setHours(19, 0, 0, 0)
      } else {
        // 주간거래 (데이마켓, 19:00 ~ 04:00)
        phase = 'day-market'
        statusLabel = '주간거래 (데이터 반영불가)'
        hasRealTimeData = false
        nextChangeTime = new Date(nyTime)
        if (currentMinutes >= afterExtendedEnd) {
          // 19:00 이후 -> 다음날 04:00
          nextChangeTime.setDate(nextChangeTime.getDate() + 1)
        }
        nextChangeTime.setHours(4, 0, 0, 0)
      }

      // 다음 시간대까지 남은 시간 계산
      const diff = nextChangeTime.getTime() - nyTime.getTime()
      const hoursLeft = Math.floor(diff / (1000 * 60 * 60))
      const minsLeft = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

      let timeInfo = ''
      if (phase === 'regular') {
        timeInfo = `마감까지 ${hoursLeft}시간 ${minsLeft}분`
      } else if (phase === 'pre-market') {
        timeInfo = `정규장까지 ${hoursLeft}시간 ${minsLeft}분`
      } else if (phase === 'after-market' || phase === 'after-extended') {
        timeInfo = `종료까지 ${hoursLeft}시간 ${minsLeft}분`
      } else {
        timeInfo = `프리마켓까지 ${hoursLeft}시간 ${minsLeft}분`
      }

      setStatus({
        phase,
        isSummerTime: isSummer,
        statusLabel,
        timeInfo,
        hasRealTimeData
      })
    }

    // 초기 실행
    updateMarketStatus()
    
    // 1초마다 업데이트
    const interval = setInterval(updateMarketStatus, 1000)
    
    return () => clearInterval(interval)
  }, [])

  // 시장 상태에 따른 CSS 클래스 결정
  const getStatusClass = () => {
    if (status.phase === 'regular') return 'open'
    if (status.phase === 'weekend' || status.phase === 'day-market') return 'closed'
    return 'extended' // pre-market, after-market, after-extended
  }



  return (
    <div className="market-status">
      <div className={`status-indicator ${getStatusClass()}`}>
        <div className="status-light"></div>
        <div className="status-text">
          <span className="status-label">
            {status.statusLabel}
          </span>
          <span className="status-time">
            {status.timeInfo}
          </span>
        </div>
      </div>
    </div>
  )
}

export default MarketStatus


