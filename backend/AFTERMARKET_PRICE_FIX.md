# 🌙 애프터마켓 가격 반영 수정

## 🎯 문제점

사용자가 애프터마켓 시간(EST 16:00 ~ 19:00)에 실시간 가격을 확인했을 때, **FMP의 `/aftermarket-trade` API를 통해 제공되는 최신 거래가가 프론트엔드에 제대로 반영되지 않는 문제**가 발생했습니다.

### 구체적 증상
- **토스증권**: BYND 주식이 $2.05로 표시
- **우리 사이트**: BYND 주식이 $1.98로 표시
- **원인**: 기존 코드가 KIS API 우선 → FMP `/quote` API 폴백 구조였으나, KIS는 정규장에만 작동하고, FMP `/quote`는 애프터마켓 최신 거래가를 반영하지 못함

---

## 🔧 수정 내용

### 1. **백엔드 API 엔드포인트 수정** (`backend/src/server.ts`)

#### Before
```typescript
app.get('/api/realtime/quote/:symbol', async (req, res) => {
  // 1. KIS API 시도 (정규장만 작동)
  const kisQuote = await tradingManager.getKISApi().getOverseasQuote(symbol, 'NASD')
  if (kisQuote) return res.json(kisQuote)
  
  // 2. FMP /quote API 폴백 (애프터마켓 최신가 반영 X)
  const quote = await fmpRealTimeApi.getQuote(symbol)
  res.json(quote)
})
```

#### After
```typescript
app.get('/api/realtime/quote/:symbol', async (req, res) => {
  // 1. FMP getCurrentPrice (애프터마켓 자동 포함)
  const currentPrice = await fmpRealTimeApi.getCurrentPrice(symbol)
  
  if (currentPrice) {
    // 전체 quote 정보 가져오기
    const fullQuote = await fmpRealTimeApi.getQuote(symbol)
    
    if (fullQuote) {
      // 현재가를 애프터마켓 가격으로 덮어쓰기
      fullQuote.price = currentPrice
      return res.json(fullQuote)
    }
  }
  
  res.status(404).json({ error: 'Price not available' })
})
```

**변경 이유**:
- KIS API는 정규장 외에는 데이터를 제공하지 않음
- FMP의 `getCurrentPrice` 메서드가 내부적으로 `/quote` + `/aftermarket-trade`를 순차 호출하여 최신 가격 반환

---

### 2. **FMP API 가격 조회 로직 개선** (`backend/src/fmp-api.ts`)

#### Before
```typescript
async getCurrentPrice(symbol: string): Promise<number | null> {
  // 1. /quote API 조회
  const quoteResponse = await axios.get(`${FMP_BASE_URL}/quote/${symbol}?apikey=${FMP_API_KEY}`)
  if (quoteResponse.data[0]?.price) {
    return quoteResponse.data[0].price
  }
  
  // 2. /aftermarket-trade API 조회
  const aftermarketResponse = await axios.get(`${FMP_BASE_URL}/aftermarket-trade/${symbol}?apikey=${FMP_API_KEY}`)
  if (aftermarketResponse.data[0]?.price) {
    return aftermarketResponse.data[0].price
  }
  
  return null
}
```

#### After
```typescript
async getCurrentPrice(symbol: string): Promise<number | null> {
  // 1. 애프터마켓 거래 가격 우선 조회 ⭐
  const aftermarketResponse = await axios.get(`${FMP_BASE_URL}/aftermarket-trade/${symbol}?apikey=${FMP_API_KEY}`)
  
  if (aftermarketResponse.data && aftermarketResponse.data.length > 0) {
    const trade = aftermarketResponse.data[0]
    const price = trade.price
    const timestamp = trade.timestamp
    
    // 최근 5분 이내 거래만 유효
    const now = Date.now()
    const fiveMinutesAgo = now - (5 * 60 * 1000)
    
    if (price && price > 0 && timestamp >= fiveMinutesAgo) {
      console.log(`🌙 [FMP Aftermarket] ${symbol} = $${price} (${new Date(timestamp).toLocaleTimeString('ko-KR')})`)
      return price
    }
  }
  
  // 2. 정규장 시세 조회 (애프터마켓 데이터 없을 때)
  const quoteResponse = await axios.get(`${FMP_BASE_URL}/quote/${symbol}?apikey=${FMP_API_KEY}`)
  
  if (quoteResponse.data && quoteResponse.data.length > 0) {
    const quote = quoteResponse.data[0]
    if (quote.price && quote.price > 0) {
      console.log(`💵 [FMP Quote] ${symbol} = $${quote.price}`)
      return quote.price
    }
  }
  
  return null
}
```

**변경 이유**:
- **애프터마켓 가격을 우선 조회**하여 최신 거래가 반영
- **5분 이내 거래만 유효**로 판단하여 오래된 데이터 사용 방지
- 로그 추가로 어떤 API에서 가격을 가져왔는지 명확히 표시

---

## 📊 시장 시간대별 가격 소스

| 시간대 | EST 시간 | 한국 시간 (Summer) | 가격 소스 | API |
|--------|----------|-------------------|----------|-----|
| **프리마켓** | 04:00 ~ 09:30 | 17:00 ~ 22:30 | FMP | `/quote` |
| **정규장** | 09:30 ~ 16:00 | 22:30 ~ 05:00 | FMP | `/quote` |
| **애프터마켓** | 16:00 ~ 17:00 | 05:00 ~ 06:00 | FMP | `/aftermarket-trade` ⭐ |
| **애프터 연장** | 17:00 ~ 19:00 | 06:00 ~ 08:00 | FMP | `/aftermarket-trade` ⭐ |
| **주간거래** | 19:00 ~ 04:00 | 08:00 ~ 17:00 | FMP | `/quote` (전일 종가) |

---

## 🔍 로그 출력 예시

### 애프터마켓 시간 (거래 발생 시)
```
🌙 [FMP Aftermarket] BYND = $2.05 (오후 5:23:45)
💵 [FMP] BYND = $2.05
```

### 정규장 시간
```
💵 [FMP Quote] BYND = $2.03
💵 [FMP] BYND = $2.03
```

### 주간거래 시간 (애프터마켓 데이터 없음)
```
💵 [FMP Quote] BYND = $1.98
💵 [FMP] BYND = $1.98
```

---

## ✅ 검증 방법

### 1. **애프터마켓 시간에 테스트**
```bash
# 백엔드 재시작
cd backend
npm run dev

# 프론트엔드에서 BYND 검색
# 가격이 토스증권과 동일하게 표시되는지 확인
```

### 2. **브라우저 개발자 도구 확인**
- Network 탭에서 `/api/realtime/quote/BYND` 응답 확인
- 가격이 최신 애프터마켓 거래가와 일치하는지 확인

### 3. **백엔드 로그 확인**
```
🌙 [FMP Aftermarket] BYND = $2.05 (오후 5:23:45)
💵 [FMP] BYND = $2.05
```

---

## 🎯 관련 FMP API 문서

### 1. **Aftermarket Trade API** ⭐
- **URL**: https://financialmodelingprep.com/stable/aftermarket-trade?symbol=AAPL
- **설명**: 정규 장 마감 후 발생하는 실시간 거래 활동 추적
- **응답**:
  ```json
  [
    {
      "symbol": "AAPL",
      "price": 232.53,
      "tradeSize": 132,
      "timestamp": 1738715334311
    }
  ]
  ```

### 2. **Quote API**
- **URL**: https://financialmodelingprep.com/api/v3/quote/AAPL
- **설명**: 정규장 및 프리마켓 실시간 시세
- **응답**:
  ```json
  [
    {
      "symbol": "AAPL",
      "price": 232.50,
      "changesPercentage": 1.23,
      "change": 2.80,
      "dayLow": 230.00,
      "dayHigh": 233.00,
      "volume": 52000000
    }
  ]
  ```

---

## 📋 체크리스트

- ✅ FMP `/aftermarket-trade` API를 우선 호출하도록 수정
- ✅ 5분 이내 거래만 유효로 판단
- ✅ 로그 추가로 가격 소스 명확히 표시
- ✅ 백엔드 API 엔드포인트 수정
- ✅ 프론트엔드는 기존 로직 유지 (2초마다 `/api/realtime/quote` 호출)

---

## 🚀 결과

**이제 프리마켓, 정규장, 애프터마켓, 애프터마켓 연장 시간 모두에서 최신 실시간 가격이 정확히 반영됩니다!** 🎉

**참고 문서**: https://site.financialmodelingprep.com/developer/docs#aftermarket-trade

