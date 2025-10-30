# 📊 매매 시스템 현황 분석 및 개선안

## 🕐 미국 주식 거래 시간대 (정확한 정리)

### 한국시간 기준
```
⏰ 18:00 ~ 23:30 (서머 17:00~22:30)  → 프리마켓 (Pre-market)
   EST: 04:00~09:30
   └─ KIS WebSocket: ❌ 호가 데이터 없음
   └─ FMP API: ✅ 일부 데이터 (15분 지연)
   └─ 매매: ❌ 불가

⏰ 23:30 ~ 06:00 (서머 22:30~05:00)  → 정규장 (Regular Hours)
   EST: 09:30~16:00
   └─ KIS WebSocket: ✅ 실시간 호가
   └─ KIS API: ✅ 실시간 현재가
   └─ 매매: ✅ 가능

⏰ 06:00 ~ 07:00 (서머 05:00~07:00)  → 애프터마켓 (After-hours)
   EST: 16:00~17:00
   └─ KIS WebSocket: ❌ 호가 데이터 없음
   └─ FMP API: ✅ 애프터마켓 데이터
   └─ 매매: ❌ 불가

⏰ 07:00 ~ 18:00 (서머 07:00~17:00)  → 데이마켓 (장 마감)
   EST: 17:00~04:00
   └─ KIS WebSocket: ❌ 작동 안 함
   └─ FMP API: ❌ 전일 종가만 제공
   └─ 매매: ❌ 불가
```

### ⚠️ 결론
**KIS API는 정규장(23:30~06:00)만 지원합니다!**
- 프리마켓, 애프터마켓: KIS WebSocket 호가 없음
- 데이마켓: 모든 실시간 데이터 없음 (전일 종가)

---

## 📋 현재 매도/매수 로직 분석

### 1️⃣ 매수/매도 주문 흐름

```typescript
// kis-api-manager.ts
async buyStock(ticker, quantity, price?) {
  // 1. 가격 없으면 FMP에서 조회
  if (!price) {
    price = await fmpApi.getCurrentPrice(ticker)
  }

  // 2. KIS API 매수 주문 (지정가)
  POST /uapi/overseas-stock/v1/trading/order
  {
    ORD_DVSN: '00',  // 지정가
    OVRS_ORD_UNPR: price.toFixed(2),
    PDNO: ticker,
    ORD_QTY: quantity
  }

  // 3. 주문 응답 확인
  if (rt_cd === '0') {
    // ✅ 주문 성공 (하지만 체결은 아직 안 됨!)
    return response.data
  }
}
```

### 2️⃣ 문제점

**현재 시스템은:**
1. ✅ 주문 전송: `/uapi/overseas-stock/v1/trading/order`
2. ❌ **체결 확인 안 함**: 주문 성공 = 체결 완료로 착각
3. ❌ **미체결내역 조회 안 함**: `/uapi/overseas-stock/v1/trading/inquire-nccs`
4. ❌ **체결내역 조회 안 함**: `/uapi/overseas-stock/v1/trading/inquire-ccnl`
5. ❌ **체결 웹훅 없음**: KIS WebSocket 체결 알림 미구현
6. ❌ **DB 업데이트 타이밍**: 주문 즉시 DB 저장 (체결 전)

**결과:**
- 주문은 성공했지만 체결은 안 된 상태를 "보유"로 표시
- 미체결 주문이 DB에 "체결 완료"로 저장됨
- 취소/정정 불가능 (주문번호 추적 안 함)

---

## 🔥 개선안: 완전한 주문 관리 시스템

### 1️⃣ 주문 → 체결 전체 플로우

```typescript
// 📤 1단계: 주문 전송
POST /uapi/overseas-stock/v1/trading/order
  ↓
응답: { rt_cd: '0', odno: '주문번호12345' }
  ↓
DB에 저장: _PENDING_ORDERS (상태: 'pending')
{
  po_order_number: '주문번호12345',
  po_ticker: 'AAPL',
  po_quantity: 10,
  po_status: 'pending',  // pending → filled → cancelled
  po_order_time: now()
}

// 📊 2단계: 체결 확인 (2가지 방법)

방법A) 폴링 (10초마다)
  ├─ GET /uapi/overseas-stock/v1/trading/inquire-nccs  // 미체결
  │    └─ 미체결에 있으면: 상태 = 'pending' 유지
  │
  └─ GET /uapi/overseas-stock/v1/trading/inquire-ccnl  // 체결
       └─ 체결되면: 상태 = 'filled', DB 업데이트
           ├─ _PENDING_ORDERS 삭제
           ├─ _POSITIONS 추가/업데이트
           └─ _TRADING_HISTORY 추가

방법B) 웹소켓 (실시간) ✨ 권장
  └─ KIS WebSocket: 체결 알림 구독
       TR ID: 'H0STCNI0' (해외주식 체결/미체결)
       └─ 체결 즉시 알림 → DB 업데이트
```

### 2️⃣ 주문 취소 흐름

```typescript
// 취소 요청
POST /uapi/overseas-stock/v1/trading/order-rvsecncl
{
  ORGN_ODNO: '주문번호12345',  // 원주문번호
  RVSE_CNCL_DVSN_CD: '02'      // 02: 취소
}
  ↓
_PENDING_ORDERS 업데이트: status = 'cancelled'
```

### 3️⃣ 예약 주문 흐름

```typescript
// 정규장 외 시간에 주문 시
POST /uapi/overseas-stock/v1/trading/order-resv
{
  ORD_DVSN: '34',  // 34: 시간외단일가
  PDNO: 'AAPL',
  ORD_QTY: '10'
}
  ↓
_PENDING_ORDERS 저장: po_reservation_type = 'opening'
  ↓
정규장 오픈 시:
  GET /uapi/overseas-stock/v1/trading/order-resv-ccnl  // 예약체결조회
  └─ 체결 확인 후 _POSITIONS 업데이트
```

---

## 🎯 구현 우선순위

### Phase 1: 기본 체결 확인 (폴링 방식)
```typescript
// order-monitor.ts에 추가
class OrderMonitor {
  // 10초마다 미체결/체결 조회
  private async checkPendingOrders() {
    const pendingOrders = await getPendingOrders()
    
    for (const order of pendingOrders) {
      // 1. 미체결 조회
      const nccs = await kisApi.inquireNccs()
      const isStillPending = nccs.find(n => n.odno === order.po_order_number)
      
      if (!isStillPending) {
        // 2. 체결내역 조회
        const ccnl = await kisApi.inquireCcnl()
        const filled = ccnl.find(c => c.odno === order.po_order_number)
        
        if (filled) {
          // 체결 완료!
          await this.handleOrderFilled(order, filled)
        }
      }
    }
  }
  
  private async handleOrderFilled(order, filled) {
    // _PENDING_ORDERS 삭제
    await deletePendingOrder(order.po_id)
    
    // _POSITIONS 추가
    await saveDBPosition({
      p_ticker: order.po_ticker,
      p_quantity: filled.ft_ccld_qty,  // 체결수량
      p_buy_price: filled.ft_ccld_unpr3,  // 체결가격
      p_account_type: order.po_account_type
    })
    
    // _TRADING_HISTORY 추가
    await saveTradingRecord({
      th_ticker: order.po_ticker,
      th_type: order.po_order_type,
      th_quantity: filled.ft_ccld_qty,
      th_price: filled.ft_ccld_unpr3,
      th_status: 'COMPLETED'
    })
  }
}
```

### Phase 2: 실시간 체결 웹훅 (WebSocket)
```typescript
// kis-websocket.ts에 추가
class KISWebSocketService {
  // 체결/미체결 알림 구독
  async subscribeOrderNotification() {
    const message = {
      header: {
        approval_key: this.approvalKey,
        custtype: 'P',
        tr_type: '1'
      },
      body: {
        input: {
          tr_id: 'H0STCNI0',  // 해외주식 체결/미체결
          tr_key: '' // 전체 구독
        }
      }
    }
    this.ws.send(JSON.stringify(message))
  }
  
  private handleOrderNotification(data) {
    // 체결 알림 수신
    if (data.odno) {  // 주문번호
      const orderNumber = data.odno
      const filledQty = data.ft_ccld_qty
      const filledPrice = data.ft_ccld_unpr3
      
      // Socket.IO로 프론트엔드에 알림
      io.emit('order:filled', {
        orderNumber,
        filledQty,
        filledPrice,
        timestamp: new Date()
      })
      
      // DB 업데이트
      this.updateOrderStatus(orderNumber, 'filled')
    }
  }
}
```

### Phase 3: 주문 취소 및 정정
```typescript
// kis-api-manager.ts에 추가
async cancelOrder(orderNumber: string) {
  const body = {
    CANO: this.cano,
    ACNT_PRDT_CD: this.acntPrdtCd,
    OVRS_EXCG_CD: 'NASD',
    ORGN_ODNO: orderNumber,
    RVSE_CNCL_DVSN_CD: '02'  // 02: 취소
  }
  
  const response = await axios.post(
    `${this.getBaseUrl()}/uapi/overseas-stock/v1/trading/order-rvsecncl`,
    body,
    { headers: { tr_id: this.getTrId('TTTT1004U') } }
  )
  
  return response.data
}

async modifyOrder(orderNumber: string, newPrice: number, newQty: number) {
  const body = {
    ORGN_ODNO: orderNumber,
    RVSE_CNCL_DVSN_CD: '01',  // 01: 정정
    ORD_QTY: newQty.toString(),
    OVRS_ORD_UNPR: newPrice.toFixed(2)
  }
  
  // ... 동일한 API 호출
}
```

### Phase 4: 예약 주문 (정규장 외)
```typescript
async reserveOrder(ticker: string, quantity: number, price: number) {
  // 시간외 주문 (장 시작 시 자동 체결)
  const body = {
    CANO: this.cano,
    ACNT_PRDT_CD: this.acntPrdtCd,
    OVRS_EXCG_CD: 'NASD',
    PDNO: ticker,
    ORD_QTY: quantity.toString(),
    OVRS_ORD_UNPR: price.toFixed(2),
    ORD_DVSN: '34'  // 34: 시간외단일가
  }
  
  const response = await axios.post(
    `${this.getBaseUrl()}/uapi/overseas-stock/v1/trading/order-resv`,
    body,
    { headers: { tr_id: this.getTrId('TTTS0305U') } }
  )
  
  // DB에 예약 주문으로 저장
  await savePendingOrder({
    po_reservation_type: 'opening',
    po_order_number: response.data.odno
  })
}
```

---

## 📊 최종 정리

### 현재 상태
❌ 주문만 전송하고 체결 확인 안 함
❌ 미체결 주문을 "보유"로 표시
❌ 주문 취소/정정 불가능
❌ 예약 주문 미구현

### 개선 후
✅ 주문 → 체결 전체 플로우 구현
✅ 실시간 체결 알림 (WebSocket)
✅ 미체결/체결 상태 정확히 추적
✅ 주문 취소/정정 가능
✅ 정규장 외 예약 주문 지원

### 시간대별 동작
**정규장 (23:30~06:00)**
- 즉시 주문 → 체결 확인 → DB 업데이트

**정규장 외 (그 외 시간)**
- 예약 주문 → 정규장 오픈 시 자동 체결 → DB 업데이트

---

## 🚀 다음 단계

1. **Phase 1** 먼저 구현: 폴링 방식 체결 확인
2. **Phase 2** 추가: 실시간 체결 WebSocket
3. **Phase 3** 구현: 취소/정정 기능
4. **Phase 4** 완성: 예약 주문

구현하시겠습니까?

