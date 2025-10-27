import React, { useState, useEffect } from 'react'
import './MarketStatus.css'

const MarketStatus: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [timeUntilOpen, setTimeUntilOpen] = useState('')
  const [timeUntilClose, setTimeUntilClose] = useState('')

  useEffect(() => {
    const updateMarketStatus = () => {
      const now = new Date()
      const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const day = nyTime.getDay() // 0=일요일, 6=토요일
      const hours = nyTime.getHours()
      const minutes = nyTime.getMinutes()
      const currentMinutes = hours * 60 + minutes

      // 주말 체크
      if (day === 0 || day === 6) {
        setIsOpen(false)
        // 다음 월요일 계산
        const daysUntilMonday = day === 0 ? 1 : 2
        const nextMonday = new Date(nyTime)
        nextMonday.setDate(nextMonday.getDate() + daysUntilMonday)
        nextMonday.setHours(9, 30, 0, 0)
        
        const diff = nextMonday.getTime() - nyTime.getTime()
        const daysLeft = Math.floor(diff / (1000 * 60 * 60 * 24))
        const hoursLeft = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        
        setTimeUntilOpen(`${daysLeft}일 ${hoursLeft}시간`)
        setTimeUntilClose('')
        return
      }

      // 9:30 AM ~ 4:00 PM (EST)
      const marketOpen = 9 * 60 + 30 // 9:30 AM = 570분
      const marketClose = 16 * 60 // 4:00 PM = 960분

      if (currentMinutes >= marketOpen && currentMinutes < marketClose) {
        // 장 중
        setIsOpen(true)
        const minutesUntilClose = marketClose - currentMinutes
        const hoursLeft = Math.floor(minutesUntilClose / 60)
        const minsLeft = minutesUntilClose % 60
        setTimeUntilClose(`${hoursLeft}시간 ${minsLeft}분`)
        setTimeUntilOpen('')
      } else {
        // 장 마감
        setIsOpen(false)
        
        let nextOpenTime: Date
        if (currentMinutes < marketOpen) {
          // 오늘 오픈 전
          nextOpenTime = new Date(nyTime)
          nextOpenTime.setHours(9, 30, 0, 0)
        } else {
          // 오늘 마감 후 -> 다음 날
          nextOpenTime = new Date(nyTime)
          nextOpenTime.setDate(nextOpenTime.getDate() + 1)
          nextOpenTime.setHours(9, 30, 0, 0)
          
          // 금요일이면 월요일로
          if (day === 5 && currentMinutes >= marketClose) {
            nextOpenTime.setDate(nextOpenTime.getDate() + 2)
          }
        }
        
        const diff = nextOpenTime.getTime() - nyTime.getTime()
        const hoursLeft = Math.floor(diff / (1000 * 60 * 60))
        const minsLeft = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
        
        setTimeUntilOpen(`${hoursLeft}시간 ${minsLeft}분`)
        setTimeUntilClose('')
      }
    }

    // 초기 실행
    updateMarketStatus()
    
    // 1초마다 업데이트
    const interval = setInterval(updateMarketStatus, 1000)
    
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="market-status">
      <div className={`status-indicator ${isOpen ? 'open' : 'closed'}`}>
        <div className="status-light"></div>
        <div className="status-text">
          <span className="status-label">
            {isOpen ? '정규장 오픈' : '장 마감'}
          </span>
          <span className="status-time">
            {isOpen 
              ? `마감까지 ${timeUntilClose}` 
              : `오픈까지 ${timeUntilOpen}`
            }
          </span>
        </div>
      </div>
    </div>
  )
}

export default MarketStatus


