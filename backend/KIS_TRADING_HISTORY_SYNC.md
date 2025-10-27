# KIS 거래내역 동기화 기능 구현 완료

## 🎯 문제 해결

### ❌ 기존 문제
```
📊 DB 조회 결과: 0개
⚠️ 거래내역이 비어있습니다. DB를 확인하세요.
```

**원인**: KIS API에서 거래내역을 조회하는 기능이 구현되지 않아 DB에 데이터가 저장되지 않음

---

## ✅ 구현 내용

### 1. KIS API 거래내역 조회 구현

**파일**: `backend/src/kis-api-manager.ts`

**API 정보**:
- **TR ID**: `TTSC0404R` (실전), `VTSC0404R` (모의)
- **API 명**: 해외주식 주문체결내역 조회
- **엔드포인트**: `/uapi/overseas-stock/v1/trading/inquire-ccnl`

**구현 함수**:
```typescript
async getTradingHistory(startDate: string, endDate: string): Promise<any> {
  // 날짜 형식: YYYY-MM-DD → YYYYMMDD
  // 조회 범위: startDate ~ endDate
  // 반환: output[] 배열 (거래 목록)
}
```

**주요 파라미터**:
- `ORD_STRT_DT`: 조회시작일자
- `ORD_END_DT`: 조회종료일자
- `SLL_BUY_DVSN`: `00`(전체), `01`(매도), `02`(매수)
- `CCLD_NCCS_DVSN`: `00`(전체), `01`(미체결), `02`(체결)

---

### 2. 동기화 서비스 구현

**파일**: `backend/src/kis-sync-service.ts`

**기능**:
- 최근 30일 거래내역 조회
- 중복 체크 (티커 + 수량 + 날짜)
- DB에 자동 저장
- 1분마다 자동 실행

**로직**:
```typescript
private async syncTradingHistory() {
  1. KIS API로 최근 30일 거래내역 조회
  2. 체결 완료된 거래만 필터링 (ccld_nccs_dvsn === '02')
  3. DB와 중복 체크
  4. 새로운 거래만 DB에 저장
}
```

---

## 📊 KIS API 응답 구조

### output 필드 예시
```json
{
  "output": [
    {
      "pdno": "AAPL",              // 종목코드
      "sll_buy_dvsn_cd": "02",     // 01:매도, 02:매수
      "ccld_nccs_dvsn": "02",      // 01:미체결, 02:체결
      "ft_ccld_unpr": "150.50",    // 체결단가
      "ccld_qty": "10",            // 체결수량
      "ft_ccld_amt": "1505.00",    // 체결금액
      "ord_dt": "20251027",        // 주문일자
      "ccld_dt": "20251027",       // 체결일자
      "ccld_tm": "093000"          // 체결시각
    }
  ]
}
```

---

## 🔄 동작 흐름

### 자동 동기화 (1분마다)
```
1. 서버 시작 → kisSyncService.start()
   ↓
2. 5초 후 첫 동기화 실행
   ↓
3. syncTradingHistory() 호출
   ↓
4. KIS API로 최근 30일 조회
   ↓
5. 체결 완료 거래만 필터링
   ↓
6. 중복 체크 (DB 조회)
   ↓
7. 새로운 거래 → saveTradingRecord()
   ↓
8. DB에 저장 (_TRADING_HISTORY)
   ↓
9. 1분 후 다시 실행
```

### 수동 동기화 (버튼 클릭)
```
1. 프론트엔드: "🔄 KIS 동기화" 버튼 클릭
   ↓
2. POST /api/trading/sync
   ↓
3. kisSyncService.manualSync()
   ↓
4. syncAll() → syncTradingHistory()
   ↓
5. 즉시 동기화 실행
```

---

## 🧪 테스트 방법

### 1. 서버 재시작
```bash
cd backend
npm run dev
```

### 2. 로그 확인
서버 시작 5초 후:
```
🔄 KIS 데이터 동기화 시작...
💰 잔고 동기화 중...
📊 보유 포지션 동기화 중...
📜 거래내역 동기화 중...
📜 KIS 거래내역 조회 성공: X개
📥 KIS에서 X개 거래내역 조회
✅ 거래내역 저장: AAPL (매수)
✅ 거래내역 저장: TSLA (매도)
✅ 거래내역 동기화 완료
✅ KIS 데이터 동기화 완료
```

### 3. DB 확인
```sql
SELECT * FROM _TRADING_HISTORY 
ORDER BY th_timestamp DESC 
LIMIT 20;
```

**예상 결과**:
```
+-------+----------------+----------+---------+----------+-------+
| th_id | th_account_type| th_ticker| th_type | th_price | th_qty|
+-------+----------------+----------+---------+----------+-------+
|     1 | REAL           | AAPL     | buy     |   150.50 |    10 |
|     2 | REAL           | TSLA     | sell    |   242.30 |     5 |
+-------+----------------+----------+---------+----------+-------+
```

### 4. 프론트엔드 확인
1. 거래내역 탭 클릭
2. 서버 로그 확인:
   ```
   📜 거래내역 조회 요청 (REAL)
   🔍 거래내역 조회 SQL: SELECT * FROM _TRADING_HISTORY WHERE th_account_type = ? [REAL]
   📊 DB 조회 결과: 2개
      샘플: AAPL(REAL), TSLA(REAL)
   📋 조회된 거래내역: 2개
   ```
3. 화면에 거래내역 표시 확인

---

## ⚠️ 주의사항

### 1. KIS API 호출 빈도
- 거래내역 조회는 **최근 30일**만 조회
- 1분마다 자동 실행되므로 API 호출 횟수 주의
- 필요시 `SYNC_INTERVAL` 조정 (현재 60000ms = 1분)

### 2. 중복 저장 방지
- 티커 + 수량 + 날짜로 중복 체크
- 이미 DB에 있는 거래는 스킵

### 3. 계정 타입별 저장
- 실전투자: `th_account_type = 'REAL'`
- 모의투자: `th_account_type = 'VIRTUAL'`
- 계정 전환 시 자동으로 해당 계정 타입의 거래내역만 조회

### 4. 데이터 형식
- **날짜**: KIS API는 `YYYYMMDD` 형식
- **금액**: 문자열 → `parseFloat()` 변환
- **매수/매도**: `sll_buy_dvsn_cd` (01:매도, 02:매수)

---

## 🔧 문제 해결

### Case 1: "KIS에서 조회된 거래내역 없음"

**원인**: 최근 30일 동안 체결된 거래가 없음

**해결**:
1. KIS HTS에서 실제 거래 확인
2. 거래가 있다면 날짜 범위 확장:
   ```typescript
   // kis-sync-service.ts
   const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // 30일 → 90일
   ```

---

### Case 2: "거래내역 저장 실패"

**원인**: DB 스키마 불일치 또는 필드 파싱 오류

**확인**:
```typescript
// kis-sync-service.ts의 saveTradingRecord 호출 부분
console.log('KIS 데이터:', item)
```

**해결**: KIS API 응답 필드명 확인 및 수정

---

### Case 3: API 호출 실패 (초당 거래건수 초과)

**원인**: KIS API Rate Limit

**해결**:
```typescript
// kis-sync-service.ts
private readonly SYNC_INTERVAL = 120000 // 1분 → 2분
```

---

## 📈 성능 최적화

### 1. 조회 기간 최적화
```typescript
// 최근 7일만 조회 (더 자주 실행 가능)
const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
```

### 2. 배치 저장
```typescript
// 여러 거래를 한 번에 저장 (트랜잭션 사용)
await pool.query('START TRANSACTION')
// ... 여러 INSERT
await pool.query('COMMIT')
```

### 3. 캐싱
- 마지막 동기화 시간 저장
- 이미 조회한 날짜는 재조회 안 함

---

## ✅ 최종 체크리스트

### 구현 완료 항목
- [x] KIS API 거래내역 조회 함수 구현
- [x] 동기화 서비스에 거래내역 동기화 추가
- [x] 중복 체크 로직 구현
- [x] 계정 타입별 저장
- [x] 자동 동기화 (1분마다)
- [x] 수동 동기화 (버튼)
- [x] 에러 핸들링
- [x] 로깅

### 테스트 항목
- [ ] 서버 재시작 후 자동 동기화 확인
- [ ] 수동 동기화 버튼 클릭 테스트
- [ ] DB에 거래내역 저장 확인
- [ ] 프론트엔드에서 거래내역 표시 확인
- [ ] 실전/모의 계정 전환 시 동작 확인
- [ ] 중복 저장 방지 확인

---

## 🚀 다음 실행

**즉시 실행하세요:**

1. 서버 재시작
   ```bash
   npm run dev
   ```

2. 로그 확인 (5초 후)
   ```
   📜 거래내역 동기화 중...
   ```

3. 프론트엔드 거래내역 탭 확인

4. 문제 발생 시:
   - 서버 로그 전체 복사
   - `SELECT * FROM _TRADING_HISTORY;` 결과
   - 제공하면 정확한 해결책 제시

