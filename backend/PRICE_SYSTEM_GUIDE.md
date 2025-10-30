# 📊 실시간 가격 시스템 가이드

## 🎯 목표
정규장 및 정규장 외 시간에 **정확한 실시간 가격**을 제공하여 토스증권과 동일한 가격을 표시

---

## ⏰ 시간대별 가격 소스

### 1️⃣ 정규장 (EST 09:30 ~ 16:00)
**한국시간: 23:30 ~ 06:00 (서머타임: 22:30 ~ 05:00)**

| 항목 | 소스 | 우선순위 |
|------|------|----------|
| **호가 (매수/매도)** | KIS WebSocket | 1순위 ✅ |
| **현재가 (조회)** | KIS API | 1순위 ✅ |
| **차트 (일봉/분봉)** | FMP API | 2순위 (KIS 미지원) |
| **매매 주문** | KIS API | ✅ 가능 |

```typescript
// 정규장 시간 체크
const isUSMarketOpen = () => {
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const hours = nyTime.getHours()
  const minutes = nyTime.getMinutes()
  const currentMinutes = hours * 60 + minutes
  
  // 09:30 ~ 16:00 (EST)
  return currentMinutes >= 570 && currentMinutes < 960
}
```

### 2️⃣ 정규장 외 (프리마켓, 애프터마켓)
**프리마켓: 18:00 ~ 23:30**
**애프터마켓: 06:00 ~ 09:00**

| 항목 | 소스 | 우선순위 |
|------|------|----------|
| **호가 (매수/매도)** | KIS WebSocket | 1순위 ✅ |
| **현재가 (조회)** | FMP API (After-hours) | 1순위 ✅ |
| **차트 (일봉/분봉)** | FMP API | 1순위 ✅ |
| **매매 주문** | ❌ 불가 (예약 주문으로 저장) | - |

```typescript
// 정규장 외 시간
// - KIS API getCurrentPrice: null 반환 (미지원)
// - KIS WebSocket: 계속 호가 데이터 전송 ✅
// - FMP API: /aftermarket-trade, /aftermarket-quote 사용 ✅
```

---

## 🔥 구현 상세

### 1. 백엔드: KIS API (kis-api-manager.ts)

```typescript
async getCurrentPrice(ticker: string): Promise<number | null> {
  // 정규장 외 시간에는 null 반환
  if (!this.isUSMarketOpen()) {
    return null
  }

  // 정규장 중에만 KIS API 호출
  const response = await axios.get(
    `${this.getBaseUrl()}/uapi/overseas-price/v1/quotations/price`,
    {
      params: { EXCD: 'NAS', SYMB: ticker },
      headers: { tr_id: 'HHDFS00000300' }
    }
  )
  
  return response.data.output.last
}
```

### 2. 백엔드: FMP API (fmp-api.ts)

```typescript
async getCurrentPrice(symbol: string): Promise<number | null> {
  // 1. 정규장 시세 조회 (항상 시도)
  const quoteResponse = await axios.get(
    `${FMP_BASE_URL}/quote/${symbol}?apikey=${FMP_API_KEY}`
  )
  if (quoteResponse.data[0]?.price > 0) {
    return quoteResponse.data[0].price
  }
  
  // 2. 시간외 거래 가격 조회 (After-hours Trade)
  const aftermarketResponse = await axios.get(
    `${FMP_BASE_URL}/aftermarket-trade/${symbol}?apikey=${FMP_API_KEY}`
  )
  return aftermarketResponse.data[0]?.price || null
}
```

### 3. 백엔드: KIS WebSocket (kis-websocket.ts)

```typescript
// 실시간 호가 수신 (24시간 작동)
private handleMessage(message: string): void {
  const askingPriceData: AskingPriceData = {
    symb: bodyData[0],      // 종목코드 (예: NASDBYND)
    pbid1: bodyData[10],    // 매수호가1
    pask1: bodyData[11],    // 매도호가1
    vbid1: bodyData[12],    // 매수잔량1
    vask1: bodyData[13],    // 매도잔량1
    bvol: bodyData[6],      // 매수총잔량
    avol: bodyData[7]       // 매도총잔량
  }

  // Socket.IO로 프론트엔드에 전송
  io.to(`orderbook-${symbol}`).emit('orderbook-update', {
    symbol,
    bid: { price: parseFloat(pbid1) },
    ask: { price: parseFloat(pask1) }
  })
}
```

### 4. 백엔드: Order Monitor (order-monitor.ts)

```typescript
private async executeMarketOrder(order: PendingOrder) {
  // 정규장: KIS API 우선, 정규장 외: FMP API만
  let currentPrice: number | null = null
  let priceSource = ''
  
  // 1. KIS API 시도 (정규장만 지원)
  const kisPrice = await this.kisApi.getCurrentPrice(order.po_ticker)
  if (kisPrice && kisPrice > 0) {
    currentPrice = kisPrice
    priceSource = 'KIS'
  }
  
  // 2. FMP API 대체
  if (!currentPrice) {
    currentPrice = await this.fmpApi.getCurrentPrice(order.po_ticker)
    priceSource = 'FMP'
  }
  
  console.log(`💵 시장가 주문 - ${priceSource} 현재가: $${currentPrice}`)
}
```

### 5. 프론트엔드: TradingPage.tsx

```typescript
useEffect(() => {
  if (socket && selectedSymbol) {
    // 1. FMP API 실시간 가격 구독
    socket.emit('subscribe:realtime', [selectedSymbol])
    
    // 2. KIS WebSocket 호가 구독 (정규장 외에도 작동)
    socket.emit('subscribe:orderbook', selectedSymbol)
    
    // 3. KIS 호가 업데이트 리스너
    const handleOrderbookUpdate = (data: any) => {
      if (data.symbol === selectedSymbol) {
        const currentPrice = data.ask?.price // 매도 1호가
        if (currentPrice > 0) {
          console.log(`📊 [KIS 호가] ${data.symbol} = $${currentPrice}`)
          setQuote(prev => ({
            ...prev,
            price: currentPrice,
            timestamp: Date.now()
          }))
        }
      }
    }
    
    socket.on('orderbook-update', handleOrderbookUpdate)
    
    return () => {
      socket.off('orderbook-update', handleOrderbookUpdate)
      socket.emit('unsubscribe:orderbook', selectedSymbol)
    }
  }
}, [socket, selectedSymbol])
```

---

## 📋 가격 우선순위 요약

### 정규장 (23:30~06:00)
1. **호가 창**: KIS WebSocket (매도 1호가) → 토스증권과 동일
2. **현재가**: KIS API → 실시간
3. **차트**: FMP API → 지연 가능

### 정규장 외 (18:00~23:30, 06:00~09:00)
1. **호가 창**: KIS WebSocket (매도 1호가) → 토스증권과 동일 ✅
2. **현재가**: FMP API (After-hours) → 실시간
3. **차트**: FMP API → 실시간

---

## ✅ 해결된 문제

### Before (문제)
- 토스증권: $2.05
- 우리 사이트: $1.98 (15분 지연된 FMP 가격)

### After (해결)
- 토스증권: $2.05
- 우리 사이트: $2.05 (KIS WebSocket 호가)

**핵심**: KIS WebSocket은 **24시간** 호가 데이터를 제공하므로, 정규장 외 시간에도 정확한 실시간 가격 표시 가능!

---

## 🎯 최종 결론

**정규장**
- KIS WebSocket 호가 (실시간) ✅
- KIS API 현재가 (실시간) ✅
- 매매 가능 ✅

**정규장 외**
- KIS WebSocket 호가 (실시간) ✅
- FMP API 현재가 (After-hours) ✅
- 매매 불가 (예약 주문) ⏰

**로그 최소화**
- 불필요한 반복 로그 제거 ✅
- 뉴스 감지 시에만 로그 출력 ✅
- KIS/FMP 가격 조회 로그 제거 ✅


