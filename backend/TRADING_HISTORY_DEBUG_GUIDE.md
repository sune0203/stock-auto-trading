# 거래내역이 보이지 않는 문제 해결 가이드

## 🔍 문제 상황

**실전투자와 모의투자 모두에서 거래내역이 표시되지 않음**

로그:
```
📜 거래내역 조회 요청 (REAL)
📜 거래내역 조회 요청 (VIRTUAL)
```

## 📋 진단 순서

### 1단계: 서버 로그 확인

서버를 재시작한 후 프론트엔드에서 거래내역 탭을 클릭하면 다음과 같은 로그가 출력됩니다:

```
📜 거래내역 조회 요청 (REAL)
🔍 거래내역 조회 SQL: SELECT * FROM _TRADING_HISTORY WHERE th_account_type = ? [REAL]
📊 DB 조회 결과: X개
   샘플: BYND(REAL), AAPL(REAL), ...
📋 조회된 거래내역: X개
```

**확인 사항**:
- `📊 DB 조회 결과: 0개` → DB에 데이터가 없거나 필터링 문제
- `📊 DB 조회 결과: X개` 하지만 `📋 조회된 거래내역: 0개` → 서버/프론트 통신 문제

---

### 2단계: DB 직접 확인

**MySQL 클라이언트를 실행하고 아래 SQL을 실행하세요:**

```sql
-- 전체 거래내역 확인
SELECT 
    th_id,
    th_account_type,
    th_ticker,
    th_type,
    th_quantity,
    th_price,
    th_timestamp
FROM _TRADING_HISTORY 
ORDER BY th_timestamp DESC
LIMIT 20;

-- 계정 타입별 개수 확인
SELECT 
    th_account_type,
    COUNT(*) as count
FROM _TRADING_HISTORY 
GROUP BY th_account_type;
```

**예상 결과**:

#### ❌ 문제 케이스 1: 데이터가 아예 없음
```
Empty set (0.00 sec)
```
→ **해결**: 주문을 실행하여 거래내역을 생성하세요.

#### ❌ 문제 케이스 2: 모든 데이터가 VIRTUAL
```
+----------------+-------+
| th_account_type| count |
+----------------+-------+
| VIRTUAL        |    15 |
+----------------+-------+
```
→ **해결**: 3단계로 이동 (데이터 수정 필요)

#### ✅ 정상 케이스
```
+----------------+-------+
| th_account_type| count |
+----------------+-------+
| REAL           |     3 |
| VIRTUAL        |    12 |
+----------------+-------+
```

---

### 3단계: 데이터 수정 (필요시)

**문제**: 실전투자로 거래했지만 DB에 `VIRTUAL`로 저장됨

**원인**: 이전 코드 버그로 인해 `th_account_type`이 제대로 저장되지 않음

**해결**: `backend/sql/CHECK_AND_FIX_DATA.sql` 파일을 참고하여 수정

#### 방법 1: 날짜 기준 일괄 수정
```sql
-- 10월 27일 이후의 모든 거래를 REAL로 변경
UPDATE _TRADING_HISTORY 
SET th_account_type = 'REAL' 
WHERE DATE(th_timestamp) >= '2025-10-27'
AND th_account_type = 'VIRTUAL';

SELECT CONCAT('✅ ', ROW_COUNT(), '개 수정 완료') as result;
```

#### 방법 2: 특정 티커만 수정
```sql
-- BYND 거래만 REAL로 변경
UPDATE _TRADING_HISTORY 
SET th_account_type = 'REAL' 
WHERE th_ticker = 'BYND'
AND th_account_type = 'VIRTUAL';

SELECT CONCAT('✅ ', ROW_COUNT(), '개 수정 완료') as result;
```

#### 방법 3: 특정 ID만 수정
```sql
-- th_id가 10, 11, 12인 거래를 REAL로 변경
UPDATE _TRADING_HISTORY 
SET th_account_type = 'REAL' 
WHERE th_id IN (10, 11, 12);

SELECT CONCAT('✅ ', ROW_COUNT(), '개 수정 완료') as result;
```

---

### 4단계: 확인

#### DB 재확인
```sql
SELECT 
    th_account_type,
    COUNT(*) as count,
    GROUP_CONCAT(DISTINCT th_ticker) as tickers
FROM _TRADING_HISTORY 
GROUP BY th_account_type;
```

#### 프론트엔드 새로고침
1. 브라우저에서 **Ctrl + Shift + R** (강제 새로고침)
2. 실전투자 탭 → 거래내역 확인
3. 모의투자 탭 → 거래내역 확인

#### 서버 로그 확인
```
📜 거래내역 조회 요청 (REAL)
🔍 거래내역 조회 SQL: SELECT * FROM _TRADING_HISTORY WHERE th_account_type = ? [REAL]
📊 DB 조회 결과: 3개
   샘플: BYND(REAL), AAPL(REAL), TSLA(REAL)
📋 조회된 거래내역: 3개
   최근 거래: BYND (buy) - REAL
```

---

## 🎯 빠른 해결 체크리스트

### ✅ 실전투자 거래내역이 안 보일 때
1. [ ] MySQL에서 `SELECT * FROM _TRADING_HISTORY WHERE th_account_type = 'REAL'` 실행
2. [ ] 결과가 0개면: 
   - [ ] 실제로 실전투자로 거래한 적이 있는지 확인
   - [ ] 거래했다면 `th_account_type`을 `REAL`로 수정
3. [ ] 결과가 있으면:
   - [ ] 서버 로그에서 `📋 조회된 거래내역: X개` 확인
   - [ ] 프론트엔드 강제 새로고침 (Ctrl + Shift + R)

### ✅ 모의투자 거래내역이 안 보일 때
1. [ ] MySQL에서 `SELECT * FROM _TRADING_HISTORY WHERE th_account_type = 'VIRTUAL'` 실행
2. [ ] 결과가 0개면:
   - [ ] 모의투자로 거래한 적이 있는지 확인
   - [ ] 거래했다면 데이터가 누락된 것이므로 다시 거래
3. [ ] 결과가 있으면:
   - [ ] 서버 로그 확인
   - [ ] 프론트엔드 강제 새로고침

---

## 🔧 예방 조치

### 새로운 거래는 자동으로 올바르게 저장됨
코드가 수정되어 이제부터의 모든 거래는:
- `saveTradingRecord()` 호출 시 `t_account_type` 자동 저장
- `savePendingOrder()` 호출 시 `po_account_type` 자동 저장

### 확인 방법
새로운 거래 후 즉시 DB 확인:
```sql
SELECT * FROM _TRADING_HISTORY 
ORDER BY th_timestamp DESC 
LIMIT 1;
```

`th_account_type`이 정확히 `REAL` 또는 `VIRTUAL`로 저장되어 있어야 합니다.

---

## 📞 추가 지원

문제가 계속되면:
1. 서버 로그 전체 복사 (`📜 거래내역 조회 요청` 부분)
2. DB 조회 결과 스크린샷
3. 프론트엔드 브라우저 콘솔 로그

위 3가지를 제공하면 정확한 진단이 가능합니다.

