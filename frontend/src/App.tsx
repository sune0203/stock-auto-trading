import { useEffect } from 'react'
import TradingPage from './pages/TradingPage'
import './App.css'

function App() {
  // 초기 로드 시 트레이딩 페이지로 리다이렉트
  useEffect(() => {
    const hash = window.location.hash
    if (!hash || hash === '#/' || hash === '#') {
      window.location.hash = '#/trading'
    }
  }, [])

  // 항상 트레이딩 페이지만 표시
  return <TradingPage />
}

export default App

