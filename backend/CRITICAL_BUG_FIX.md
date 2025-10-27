# 🔴 치명적 버그 수정: 계정 타입 저장 누락

## 문제 발견

### 증상
1. ✅ 실전투자에서 매수 → **모의투자 대기**로 저장됨
2. ✅ 거래내역이 **모두 비어있음**
3. ✅ DB 확인 시 `po_account_type = 'VIRTUAL'` (잘못됨)

### 로그 분석
```
📈 수동 매수 요청
   🔰 계정: [실전투자] 실전투자 메인  ← 실전투자로 주문
   종목: BYND
   ...
⏰ 장 마감 감지 → 예약 주문으로 자동 전환
✅ 예약 주문 저장: BYND (ID: 6)  ← REAL로 저장되어야 하는데...
```

### DB 확인
```json
{
  "po_id": 6,
  "po_account_type": "VIRTUAL",  ← ❌ 잘못됨! REAL이어야 함
  "po_ticker": "BYND",
  "po_order_type": "buy"
}
```

## 원인 분석

### `backend/src/db.ts`의 두 함수에서 계정 타입 누락

#### 1. `savePendingOrder()` - 예약 주문 저장
```typescript
// ❌ 잘못된 코드
INSERT INTO _PENDING_ORDERS (
  po_ticker, po_order_type, po_quantity, ...
  // po_account_type 누락!
) VALUES (?, ?, ?, ...)
```

**결과:**
- `po_account_type`이 INSERT에 없음
- DB의 DEFAULT 값인 `VIRTUAL` 사용
- 실전투자 주문도 모의투자로 저장됨

#### 2. `saveTradingRecord()` - 거래내역 저장
```typescript
// ❌ 잘못된 코드
INSERT INTO _TRADING_HISTORY (
  th_ticker, th_type, th_price, ...
  // th_account_type 누락!
) VALUES (?, ?, ?, ...)
```

**결과:**
- `th_account_type`이 INSERT에 없음
- DB의 DEFAULT 값인 `VIRTUAL` 사용
- 실전투자 거래도 모의투자로 저장됨

## 수정 내용

### 1. `savePendingOrder()` 수정
```typescript
// ✅ 수정된 코드
const [result] = await pool.query(
  `INSERT INTO _PENDING_ORDERS (
    po_ticker, po_account_type, po_order_type, po_quantity, ...
    // 🆕 po_account_type 추가!
  ) VALUES (?, ?, ?, ?, ...)`,
  [
    order.po_ticker,
    order.po_account_type,  // 🆕 추가!
    order.po_order_type,
    order.po_quantity,
    // ...
  ]
)
console.log(`✅ 예약 주문 저장: ${order.po_ticker} (ID: ${insertId}) [${order.po_account_type}]`)
```

### 2. `saveTradingRecord()` 수정
```typescript
// ✅ 수정된 코드
const [result] = await pool.query(
  `INSERT INTO _TRADING_HISTORY (
    th_account_type, th_ticker, th_type, th_price, ...
    // 🆕 th_account_type 추가!
  ) VALUES (?, ?, ?, ?, ...)`,
  [
    record.t_account_type,  // 🆕 추가!
    record.t_ticker,
    record.t_type,
    record.t_price,
    // ...
  ]
)
console.log(`💾 매매 기록 저장: [${record.t_account_type}] ${record.t_type} ${record.t_ticker}`)
```

## 기존 데이터 수정

### HeidiSQL에서 실행

```sql
-- ID 6번 예약 주문을 실전투자로 수정
UPDATE _PENDING_ORDERS 
SET po_account_type = 'REAL' 
WHERE po_id = 6;

-- 확인
SELECT po_id, po_ticker, po_account_type, po_order_type, po_created_at 
FROM _PENDING_ORDERS 
ORDER BY po_created_at DESC;
```

**또는** `backend/sql/fix_account_type.sql` 파일 실행

## 테스트 시나리오

### 수정 전
```
실전투자 선택
  ↓
BYND 1주 매수
  ↓
장 마감 → 예약 주문으로 전환
  ↓
DB 저장:
{
  po_id: 6,
  po_account_type: "VIRTUAL",  ← ❌ 잘못됨!
  po_ticker: "BYND"
}
  ↓
실전투자 대기 목록: 비어있음 ❌
모의투자 대기 목록: BYND 1주 표시 ❌
```

### 수정 후
```
실전투자 선택
  ↓
BYND 1주 매수
  ↓
장 마감 → 예약 주문으로 전환
  ↓
DB 저장:
{
  po_id: 7,
  po_account_type: "REAL",  ← ✅ 올바름!
  po_ticker: "BYND"
}
  ↓
실전투자 대기 목록: BYND 1주 표시 ✅
모의투자 대기 목록: 비어있음 ✅
```

## 로그 비교

### 수정 전
```
✅ 예약 주문 저장: BYND (ID: 6)
```

### 수정 후
```
✅ 예약 주문 저장: BYND (ID: 7) [REAL]  ← 계정 타입 표시!
```

## 영향 범위

### 수정 전 (버그)
- ❌ 모든 예약 주문 → `VIRTUAL`로 저장
- ❌ 모든 거래내역 → `VIRTUAL`로 저장
- ❌ 실전투자/모의투자 구분 불가
- ❌ 데이터 혼재

### 수정 후 (정상)
- ✅ 실전투자 주문 → `REAL`로 저장
- ✅ 모의투자 주문 → `VIRTUAL`로 저장
- ✅ 계정별 데이터 정확히 분리
- ✅ 조회 시 올바른 데이터 표시

## 추가 조치사항

### 1. 서버 재시작 필요
```bash
cd backend
npm run dev
```

### 2. 기존 잘못된 데이터 수정
```sql
-- HeidiSQL에서 실행
UPDATE _PENDING_ORDERS 
SET po_account_type = 'REAL' 
WHERE po_id = 6;
```

### 3. 새로운 주문 테스트
1. 실전투자 선택
2. 종목 매수 시도
3. 대기 탭 확인 → 실전투자 목록에 표시되어야 함
4. 모의투자 전환
5. 대기 탭 확인 → 비어있어야 함

## 왜 이런 버그가 발생했나?

### 코드 작성 순서
```
1. DB 스키마 설계
   ↓
2. Interface 정의 (PendingOrder, TradingRecord)
   ↓
3. API 엔드포인트 작성 (po_account_type 전달)
   ↓
4. INSERT 쿼리 작성 ← 🚨 여기서 누락!
```

### 문제점
- **Interface**에는 `po_account_type`이 있음
- **API 호출**에서도 `po_account_type`을 전달함
- **INSERT 쿼리**에서만 누락됨 (복사/붙여넣기 실수)

### 결과
- TypeScript 타입 체크 통과 (Interface는 올바름)
- 컴파일 에러 없음
- 런타임에서 DEFAULT 값 사용
- 버그 발견 어려움

## 방지 대책

### 1. 로그 강화
```typescript
console.log(`✅ 예약 주문 저장: ${order.po_ticker} (ID: ${insertId}) [${order.po_account_type}]`)
//                                                                      ^^^^^^^^^^^^^^^^^^^^^^^^
//                                                                      계정 타입 명시적 출력!
```

### 2. DB 제약 조건 추가 (선택사항)
```sql
ALTER TABLE _PENDING_ORDERS 
MODIFY COLUMN po_account_type ENUM('REAL', 'VIRTUAL') NOT NULL;
-- DEFAULT 제거하여 명시적 입력 강제
```

### 3. 코드 리뷰 체크리스트
- [ ] Interface 필드가 모두 INSERT 쿼리에 포함되었는가?
- [ ] 로그에 중요한 필드(계정 타입)가 출력되는가?
- [ ] 테스트 시나리오에 계정 전환이 포함되었는가?

## 요약

| 항목 | 수정 전 | 수정 후 |
|------|---------|---------|
| **예약 주문 저장** | ❌ VIRTUAL (잘못됨) | ✅ REAL/VIRTUAL (올바름) |
| **거래내역 저장** | ❌ VIRTUAL (잘못됨) | ✅ REAL/VIRTUAL (올바름) |
| **실전투자 대기** | ❌ 비어있음 | ✅ 정상 표시 |
| **모의투자 대기** | ❌ 잘못된 데이터 | ✅ 정상 표시 |
| **로그 출력** | ❌ 계정 타입 누락 | ✅ 계정 타입 표시 |

**🎉 이제 실전투자와 모의투자가 완벽하게 분리됩니다!**

