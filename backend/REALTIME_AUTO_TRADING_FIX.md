# 실시간 자동 매수 수정 및 DB 스키마 마이그레이션 가이드

## 문제점

### 1. DB 스키마 오류
```
Unknown column 'po_account_type' in 'where clause'
Unknown column 'th_account_type' in 'where clause'
```
- `_PENDING_ORDERS` 테이블에 `po_account_type` 컬럼 없음
- `_TRADING_HISTORY` 테이블에 `th_account_type` 컬럼 없음

### 2. 자동 매수 중복 실행
- 이전에 처리한 뉴스를 계속 반복 확인
- 30초마다 같은 뉴스로 매수 시도
- 로그가 지속적으로 출력됨

## 해결 방법

### 1. DB 스키마 추가 (수동 실행 필요)

#### SQL 파일 생성
`backend/sql/add_account_type_columns.sql` 파일이 생성되었습니다.

#### 실행 방법

**옵션 A: MySQL 클라이언트로 실행**
```sql
-- MySQL 클라이언트에 로그인
mysql -h 116.122.37.82 -u nasdaq -p NASDAQ

-- SQL 파일 실행
source backend/sql/add_account_type_columns.sql;

-- 또는 직접 쿼리 실행
ALTER TABLE _PENDING_ORDERS 
ADD COLUMN po_account_type ENUM('REAL', 'VIRTUAL') NOT NULL DEFAULT 'VIRTUAL' 
AFTER po_ticker;

ALTER TABLE _PENDING_ORDERS 
ADD INDEX idx_po_account_type (po_account_type);

ALTER TABLE _TRADING_HISTORY 
ADD COLUMN th_account_type ENUM('REAL', 'VIRTUAL') NOT NULL DEFAULT 'VIRTUAL' 
AFTER th_id;

ALTER TABLE _TRADING_HISTORY 
ADD INDEX idx_th_account_type (th_account_type);
```

**옵션 B: phpMyAdmin / MySQL Workbench 사용**
1. DB 관리 도구에 로그인
2. `NASDAQ` 데이터베이스 선택
3. SQL 탭 열기
4. `backend/sql/add_account_type_columns.sql` 내용 복사/붙여넣기
5. 실행

**옵션 C: 서버 관리자에게 요청**
서버 관리자에게 다음을 요청:
```
116.122.37.82 MySQL 서버의 NASDAQ 데이터베이스에
po_account_type과 th_account_type 컬럼을 추가해주세요.
SQL 파일: backend/sql/add_account_type_columns.sql
```

### 2. 자동 매수 서비스 수정

#### 변경 사항 (`backend/src/auto-trading.ts`)

**이전 로직:**
```typescript
// 최근 10개 뉴스 조회
const [rows] = await pool.query(
  `SELECT * FROM _NEWS 
   WHERE n_gpt_is = 'Y' 
   AND n_ticker IS NOT NULL 
   AND n_ticker != ''
   AND (n_bullish >= 95 OR n_immediate_impact >= 95)
   ORDER BY n_in_time DESC 
   LIMIT 10`
)
```

**새 로직:**
```typescript
// 실시간으로 갱신된 뉴스만 조회 (최근 1분 이내)
const [rows] = await pool.query(
  `SELECT * FROM _NEWS 
   WHERE n_gpt_is = 'Y' 
   AND n_ticker IS NOT NULL 
   AND n_ticker != ''
   AND (n_bullish >= 95 OR n_immediate_impact >= 95)
   AND n_in_time >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)
   ORDER BY n_in_time DESC`
)
```

#### 주요 개선 사항

1. **시간 필터 추가**
   ```sql
   AND n_in_time >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)
   ```
   - 최근 1분 이내에 입력된 뉴스만 조회
   - 실시간 뉴스만 처리

2. **불필요한 로그 제거**
   ```typescript
   // 실전투자 아닐 때 로그 출력 안 함
   if (!currentAccount || currentAccount.ka_type !== 'REAL') {
     // console.log('⚠️ 자동 매수는 실전투자 계정에서만 작동합니다')
     return
   }

   // 새로운 뉴스가 없으면 로그 출력 안 함
   if (news.length === 0) {
     return
   }
   ```

3. **뉴스 입력 시간 로그 추가**
   ```typescript
   console.log(`  입력시간: ${item.n_in_time}`)
   ```

## 수정된 파일

### 백엔드
1. ✅ `backend/src/auto-trading.ts` - 실시간 뉴스만 조회
2. ✅ `backend/sql/add_account_type_columns.sql` - DB 마이그레이션 SQL
3. ✅ `backend/scripts/add-account-type-columns.js` - DB 마이그레이션 스크립트 (참고용)

## 자동 매수 작동 흐름 (수정 후)

```
30초마다 체크
    ↓
실전투자 계정 확인
    ↓
최근 1분 이내 뉴스 조회
    ↓
새 뉴스 없음 → 조용히 종료 (로그 없음)
    ↓
새 뉴스 있음 + 점수 ≥ 95%
    ↓
이미 처리한 뉴스? → 건너뛰기
    ↓
아직 처리 안 한 뉴스
    ↓
로그 출력:
  🎯 높은 점수 뉴스 감지!
  종목: AAPL
  제목: ...
  호재점수: 98%
  당일상승점수: 96%
  입력시간: 2025-10-25 14:30:15
    ↓
자동 매수 실행
    ↓
처리 완료 표시 (processedNews에 추가)
```

## 시간 필터 설명

### `DATE_SUB(NOW(), INTERVAL 1 MINUTE)`

- **NOW()**: 현재 시간
- **INTERVAL 1 MINUTE**: 1분 간격
- **DATE_SUB**: 현재 시간에서 1분을 뺌

**예시:**
```
현재 시간: 2025-10-25 14:30:00
필터 시간: 2025-10-25 14:29:00

조회 대상:
✅ n_in_time = 2025-10-25 14:29:30 (30초 전)
✅ n_in_time = 2025-10-25 14:30:00 (방금)
❌ n_in_time = 2025-10-25 14:28:00 (2분 전)
❌ n_in_time = 2025-10-25 14:20:00 (10분 전)
```

## 로그 비교

### 수정 전
```
⚠️ 자동 매수는 실전투자 계정에서만 작동합니다
(30초마다 반복 출력)

🎯 높은 점수 뉴스 감지!
  종목: AAPL
  ...
❌ 매수 가능 수량이 없습니다
(같은 뉴스로 30초마다 반복)
```

### 수정 후
```
(새 뉴스 없으면 아무 로그도 출력 안 함)

🎯 높은 점수 뉴스 감지!
  종목: AAPL
  제목: Apple announces breakthrough
  호재점수: 98%
  당일상승점수: 96%
  입력시간: 2025-10-25 14:30:15
  
💰 현재 잔고: $10000.00
💰 투자 금액 (10%): $1000.00
📊 현재가: $150.50
📊 매수 수량: 6주
📊 총 금액: $903.00

🚀 자동 매수 주문 실행 중...
✅ 자동 매수 성공!
  주문번호: 12345
📝 거래 기록 저장 완료

(다음번에는 같은 뉴스로 매수 안 함)
```

## 중복 방지 메커니즘

### 1. 시간 필터 (1분)
```sql
AND n_in_time >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)
```
→ 최근 1분 이내 뉴스만 확인

### 2. 처리 완료 Set
```typescript
private processedNews: Set<number> = new Set()
```
→ 처리한 뉴스 ID 저장

### 3. 중복 체크
```typescript
if (this.processedNews.has(item.n_idx)) {
  continue  // 이미 처리한 뉴스는 건너뛰기
}
```

### 4. 메모리 관리
```typescript
if (this.processedNews.size > 1000) {
  const array = Array.from(this.processedNews)
  this.processedNews = new Set(array.slice(-500))
}
```
→ 최근 500개만 유지

## 테스트 시나리오

### 1. 새 뉴스 추가 (점수 ≥ 95%)
```
1. _NEWS 테이블에 새 뉴스 INSERT
   n_bullish = 98
   n_immediate_impact = 96
   n_in_time = NOW()

2. 30초 이내 자동 감지
   
3. 로그 출력:
   🎯 높은 점수 뉴스 감지!
   
4. 자동 매수 실행

5. 다음 체크 (30초 후)
   → 같은 뉴스 감지 안 함 (이미 처리)
```

### 2. 오래된 뉴스 (1분 초과)
```
1. 2분 전에 입력된 뉴스
   n_in_time = 2025-10-25 14:28:00
   
2. 현재 시간: 14:30:00

3. 필터링 조건:
   n_in_time >= 14:29:00 (1분 전)
   
4. 결과: 조회 안 됨 ❌
   
5. 로그: (없음)
```

### 3. 모의투자 계정
```
1. 모의투자로 전환

2. 자동 매수 체크 실행

3. 계정 타입 확인:
   ka_type = 'VIRTUAL'
   
4. 조용히 종료 (로그 없음)
```

## 주의사항

### 1. DB 마이그레이션 필수
⚠️ **반드시 SQL을 실행해야 서버가 정상 작동합니다!**

```bash
# 오류 발생 시
Unknown column 'po_account_type' in 'where clause'
Unknown column 'th_account_type' in 'where clause'

# 해결 방법
→ backend/sql/add_account_type_columns.sql 실행
```

### 2. 실시간 뉴스만 처리
- 최근 1분 이내 뉴스만 확인
- 오래된 뉴스는 무시
- DB에 계속 쌓여있어도 처리 안 함

### 3. 실전투자 전용
- 모의투자에서는 자동 매수 안 함
- 조용히 건너뛰기 (로그 없음)

### 4. 중복 방지
- 같은 뉴스로 2번 매수 안 함
- 서버 재시작하면 초기화됨

## 다음 단계

1. **DB 마이그레이션 실행** (중요!)
   ```sql
   -- MySQL 클라이언트에서 실행
   source backend/sql/add_account_type_columns.sql;
   ```

2. **서버 재시작**
   ```bash
   cd backend
   npm run dev
   ```

3. **테스트**
   - 실전투자로 전환
   - 새 뉴스 추가 (점수 ≥ 95%)
   - 30초 이내 자동 매수 확인
   - 로그 확인

4. **모니터링**
   ```
   🎯 높은 점수 뉴스 감지!
   💰 현재 잔고: ...
   🚀 자동 매수 주문 실행 중...
   ✅ 자동 매수 성공!
   ```

완료! 🎉

