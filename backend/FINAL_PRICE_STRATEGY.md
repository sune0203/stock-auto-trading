# 🎯 최종 가격 전략: FMP 시세 + KIS 매매

## 📊 확인된 사실

### FMP API 지원 범위 (실시간 가격 제공)
```
✅ 프리마켓: 17:00 ~ 22:30 (한국시간, Summer Time)
   EST 04:00 ~ 09:30

✅ 정규장: 22:30 ~ 05:00 
   EST 09:30 ~ 16:00

✅ 애프터마켓: 05:00 ~ 07:00
   EST 16:00 ~ 17:00

✅ 애프터마켓 연장: 07:00 ~ 09:00
   EST 17:00 ~ 19:00 (Summer Time 동일)

❌ 주간거래(데이마켓): 10:00 ~ 17:00
   EST 20:00 ~ 04:00 (실시간 가격 없음, 전일 종가)
```

### KIS API 지원 범위
```
✅ 정규장: 22:30 ~ 05:00 (Summer Time)
   - WebSocket 호가 실시간 ✅
   - REST API 현재가 조회 ✅
   - 매매 가능 ✅

❌ 정규장 외: 모든 시간
   - WebSocket 호가 없음
   - REST API 현재가 없음
   - 매매 불가 (예약 주문으로 전환)
```

---

## 🎯 최종 전략

### 가격 표시
**FMP API를 주 소스로 사용**
- 프리마켓 ~ 애프터마켓 연장: **FMP 실시간 가격** (2초 폴링)
- 주간거래(데이마켓): FMP 전일 종가 (실시간 없음)
- KIS WebSocket 호가: 호가창 표시용만 사용 (정규장만)

### 매매 실행
**KIS API로만 매매**
- 정규장(22:30~05:00): 즉시 매매 ✅
- 정규장 외: 예약 주문으로 저장 → 정규장 오픈 시 자동 실행

---

## 📋 구현 상세

### 1. 프론트엔드 (TradingPage.tsx)

```typescript
// FMP 실시간 가격 우선 (2초 폴링)
const priceRefreshInterval = setInterval(fetchInitialPrice, 2000)

// FMP 가격 업데이트 리스너
socket.on('realtime:price', (data) => {
  console.log(`💵 [FMP 실시간] ${data.symbol} = $${data.price}`)
  setQuote({
    price: data.price,
    changesPercentage: data.changesPercentage,
    // ... FMP 데이터 우선 사용
  })
})

// KIS 호가는 호가창만 표시 (현재가에 반영 안 함)
socket.on('orderbook-update', (data) => {
  console.log(`📊 [KIS 호가] ${data.symbol} - 매수: $${data.bid.price}`)
  // 호가창 컴포넌트만 업데이트, quote는 FMP 유지
})
```

### 2. 백엔드 시간 체크 (자동 Summer Time)

```typescript
// America/New_York 타임존 사용 → 자동으로 EST/EDT 전환
const nyTime = new Date(now.toLocaleString('en-US', { 
  timeZone: 'America/New_York' 
}))

// Summer Time: 3월 두번째 일요일 ~ 11월 첫번째 일요일
// → JavaScript가 자동으로 처리
```

### 3. 매매 로직

```typescript
// order-monitor.ts
private async executeMarketOrder(order: PendingOrder) {
  // 1. FMP API로 현재가 조회 (프리마켓~애프터마켓 연장까지)
  let currentPrice = await this.fmpApi.getCurrentPrice(order.po_ticker)
  let priceSource = 'FMP'
  
  // 2. KIS API로 매매 (정규장만 가능)
  if (this.isMarketOpen) {
    await this.kisApi.buyStock(order.po_ticker, order.po_quantity, currentPrice)
    console.log(`✅ 매수 체결: ${order.po_ticker} @ $${currentPrice} (${priceSource})`)
  } else {
    // 정규장 외: 예약 주문으로 저장
    console.log(`⏰ 정규장 외 - 예약 주문 저장: ${order.po_ticker}`)
    await savePendingOrder({
      ...order,
      po_reservation_type: 'opening'
    })
  }
}
```

---

## ⏰ 시간대별 동작

### 프리마켓 (17:00 ~ 22:30)
- **가격 표시**: FMP 실시간 ✅
- **호가 표시**: KIS 없음 ❌
- **매매**: 예약 주문 ⏰
- **사용자 경험**: 실시간 가격 확인 가능, 주문은 정규장 오픈 시 자동 실행

### 정규장 (22:30 ~ 05:00)
- **가격 표시**: FMP 실시간 ✅
- **호가 표시**: KIS 실시간 ✅
- **매매**: KIS 즉시 체결 ✅
- **사용자 경험**: 완전한 실시간 트레이딩

### 애프터마켓 (05:00 ~ 09:00)
- **가격 표시**: FMP 실시간 ✅
- **호가 표시**: KIS 없음 ❌
- **매매**: 예약 주문 ⏰
- **사용자 경험**: 실시간 가격 확인 가능, 주문은 다음 정규장 오픈 시 실행

### 데이마켓 (10:00 ~ 17:00)
- **가격 표시**: FMP 전일 종가 (실시간 없음) ⚠️
- **호가 표시**: KIS 없음 ❌
- **매매**: 예약 주문 ⏰
- **사용자 경험**: 가격 확인 제한적, 주문은 프리마켓/정규장 오픈 시 실행

---

## 🔥 장점

1. **FMP 실시간 가격**: 프리마켓 ~ 애프터마켓 연장까지 실시간 가격 제공
2. **KIS 안정적 매매**: 정규장에서만 확실한 체결
3. **예약 주문 자동화**: 정규장 외 주문 자동 실행
4. **Summer Time 자동**: JavaScript 타임존이 자동으로 DST 처리
5. **API Rate Limit 회피**: FMP 2초 폴링으로 충분한 실시간성

---

## 📊 예상 사용자 경험

### 현재 시각: 10:30 AM (데이마켓)
```
화면 표시: $1.98 (FMP 전일 종가)
실제 시장가: $2.05 (프리마켓 가격, FMP에서 제공 안 함)

→ 데이마켓 시간에는 실시간 가격 없음
→ 17:00 (프리마켓 오픈) 이후부터 실시간 가격 표시
```

### 17:00 이후 (프리마켓 오픈)
```
화면 표시: $2.05 (FMP 실시간) ✅
매수 버튼 클릭 → "프리마켓 중 - 정규장 오픈 시 자동 실행" 안내
```

### 22:30 이후 (정규장 오픈)
```
화면 표시: $2.05 (FMP 실시간) ✅
호가창 표시: 매수 $2.04, 매도 $2.06 (KIS 실시간) ✅
매수 버튼 클릭 → 즉시 체결 ✅
```

---

## ✅ 결론

**FMP로 시세 감지, KIS로 매매 실행**

- ✅ 프리마켓 ~ 애프터마켓 연장: 실시간 가격 표시
- ✅ 정규장: 완벽한 실시간 트레이딩
- ⚠️ 데이마켓: 전일 종가만 표시 (FMP 한계)
- ✅ 예약 주문 자동화로 편의성 극대화

**토스증권과의 차이:**
- 토스증권은 유료 실시간 데이터 사용 (데이마켓에도 가격 표시)
- 우리는 FMP 무료 API 사용 (프리마켓 ~ 애프터마켓 연장만 실시간)
- 정규장에서는 **동일한 가격 및 매매 경험 제공** ✅

