# KIS 데이터 동기화 시스템 구현 완료

## 📋 문제 분석

### 캡처 이미지 분석 결과

#### 실전투자 계좌 (47133589-01)
- ✅ 잔고: $6.97 정상 표시
- ✅ 해외예수금: $10,009
- ✅ 매수가능금액: $6.97
- ✅ 총 평가금액: $1,435.10

#### 모의투자 계좌 (50155376-01)
- ✅ 보유 포지션: 15개 종목 (IMTX, APPN, BRIC, ADML, DVLT, FMAO, CMND, NDAO, BCPC, PLUG, MCW, AEC, LBIO, YRRB 등)
- ✅ 거래내역: BYND 매수 2건 확인
- ❌ **문제**: 웹에서 잔고가 $0으로 표시됨
- ✅ 실제: KIS API 데이터에는 매수 가능 금액이 존재함

## 🔧 구현 내용

### 1. 모의투자 잔고 표시 문제 수정

**파일**: `backend/src/account-cache.ts`

#### 문제
- `getBuyingPower()` API 실패 시 폴백 로직에서 `buyingPower: 0` 반환
- 모의투자 계좌의 실제 매수 가능 금액을 표시하지 못함

#### 해결
```typescript
// 🆕 외화예수금액 (frcr_dncl_amt_2) 사용 - 실제 매수 가능 금액
const cashBalance = parseFloat(output2.frcr_dncl_amt_2 || '0')

// 총 자산 = 외화예수금 + 보유 종목 평가금액
const totalAssets = cashBalance + totalPositionValue

return {
  buyingPower: cashBalance, // 외화예수금액 = 매수 가능 금액
  totalBalance: totalAssets,
  cash: cashBalance
}
```

**결과**:
- ✅ 모의투자 계좌의 실제 매수 가능 금액 정상 표시
- ✅ KIS API `output2.frcr_dncl_amt_2` 필드 활용
- ✅ 총 자산 = 외화예수금 + 보유종목 평가금액으로 정확히 계산

---

### 2. KIS 데이터 주기적 동기화 서비스

**파일**: `backend/src/kis-sync-service.ts` (신규 생성)

#### 기능
1. **1분마다 자동 동기화**
   - 잔고 갱신 (캐시 무효화)
   - 보유 포지션 갱신
   
2. **수동 동기화 API**
   - 사용자가 버튼 클릭 시 즉시 동기화
   
3. **향후 확장 가능**
   - 미체결 주문 동기화 (KIS API 구현 시)
   - 거래내역 동기화 (KIS API 구현 시)

#### 구현 코드
```typescript
class KISSyncService {
  private syncInterval: NodeJS.Timeout | null = null
  private readonly SYNC_INTERVAL = 60000 // 1분마다

  start() {
    // 초기 동기화 (5초 후)
    setTimeout(() => this.syncAll(), 5000)
    
    // 주기적 동기화
    this.syncInterval = setInterval(() => {
      this.syncAll()
    }, this.SYNC_INTERVAL)
  }

  private async syncAll() {
    // 1. 잔고 갱신
    await this.syncBalance()
    
    // 2. 보유 포지션 갱신
    await this.syncPositions()
  }
}
```

**결과**:
- ✅ 서버 시작 5초 후 첫 동기화
- ✅ 이후 1분마다 자동 동기화
- ✅ 잔고와 포지션 자동 갱신

---

### 3. 서버 통합

**파일**: `backend/src/server.ts`

#### 변경사항
```typescript
import { kisSyncService } from './kis-sync-service.js'

async function initializeServices() {
  // ... KIS API 초기화 ...
  
  // KIS 데이터 동기화 서비스 시작
  kisSyncService.start()
}

// 수동 동기화 API 엔드포인트
app.post('/api/trading/sync', async (req, res) => {
  await kisSyncService.manualSync()
  
  const balance = await accountCacheService.getBalance()
  const positions = await accountCacheService.getPositions()
  
  res.json({
    success: true,
    message: 'KIS 데이터 동기화 완료',
    data: { balance, positionCount: positions.length }
  })
})
```

**결과**:
- ✅ 서버 시작 시 자동으로 동기화 서비스 시작
- ✅ `/api/trading/sync` 엔드포인트로 수동 동기화 가능

---

### 4. 프론트엔드 수동 동기화 버튼

**파일**: `frontend/src/components/PositionPanel.tsx`

#### UI 추가
```tsx
<div className="header-buttons">
  <button 
    className="sync-btn" 
    onClick={handleManualSync}
    disabled={isSyncing}
  >
    {isSyncing ? '🔄 동기화 중...' : '🔄 KIS 동기화'}
  </button>
  <button className="refresh-btn" onClick={loadPositions}>
    새로고침
  </button>
</div>
```

#### 로직
```typescript
const handleManualSync = async () => {
  setIsSyncing(true)
  try {
    const response = await axios.post('http://localhost:3001/api/trading/sync')
    
    // 모든 데이터 새로고침
    await Promise.all([
      loadPositions(),
      loadPendingOrders(),
      loadTradingHistory()
    ])
    
    alert('KIS 데이터 동기화 완료!')
  } finally {
    setIsSyncing(false)
  }
}
```

**스타일링**: `frontend/src/components/PositionPanel.css`
```css
.sync-btn {
  padding: 6px 12px;
  border: 1px solid #4c6ef5;
  background: #4c6ef5;
  color: white;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
}

.sync-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

**결과**:
- ✅ "🔄 KIS 동기화" 버튼 추가
- ✅ 클릭 시 서버에서 최신 데이터 조회
- ✅ 동기화 중 버튼 비활성화 및 텍스트 변경
- ✅ 완료 후 알림 표시

---

## 🎯 데이터 흐름

### 자동 동기화 (1분마다)
```
1. kisSyncService.syncAll()
   ↓
2. accountCacheService.invalidateCache()
   ↓
3. KIS API 호출 (잔고 & 포지션)
   ↓
4. 캐시 업데이트
   ↓
5. DB 저장 (_ACCOUNT_BALANCE)
```

### 수동 동기화 (버튼 클릭)
```
1. 프론트엔드: handleManualSync()
   ↓
2. POST /api/trading/sync
   ↓
3. kisSyncService.manualSync()
   ↓
4. 잔고 & 포지션 갱신
   ↓
5. 프론트엔드: loadPositions/pendingOrders/tradingHistory()
   ↓
6. UI 업데이트
```

---

## 📊 DB 테이블 역할

### 현재 구조

| 테이블 | 역할 | 데이터 소스 |
|--------|------|-------------|
| `_ACCOUNT_BALANCE` | 잔고 캐시 | KIS API (주기적 갱신) |
| `_POSITIONS` | 익절/손절 설정 저장 | 사용자 설정 |
| `_TRADING_HISTORY` | 거래내역 기록 | 시스템 주문 실행 시 |
| `_PENDING_ORDERS` | 예약 주문 | 사용자 예약 주문 |

### 포지션 데이터 흐름
```
실제 보유 포지션: KIS API (실시간 조회)
    ↓
accountCacheService.getPositions()
    ↓
프론트엔드 표시
```

---

## 🔍 주요 KIS API 필드

### 잔고 조회 (TTTS3012R / VTTS3012R)

**output2 필드**:
- `frcr_dncl_amt_2`: 외화예수금액 (매수 가능 금액) ← **사용**
- `tot_asst_amt`: 총 자산 금액
- `ovrs_tot_pfls`: 해외 총 손익

### 매수가능금액 조회 (TTTS3007R / VTTS3007R)

**output 필드**:
- `ord_psbl_frcr_amt`: 주문 가능 외화 금액 ← **우선 사용**
- `max_ord_psbl_qty`: 최대 주문 가능 수량

---

## ⚠️ 주의사항

### 1. 거래내역 동기화
현재 KIS API의 "해외주식 주문체결내역" 엔드포인트는 백엔드에 미구현
- 거래내역은 시스템이 주문 실행 시 DB에 자동 저장
- KIS API 구현 후 동기화 추가 가능

### 2. 미체결 주문 동기화
현재 KIS API의 "미체결내역조회" 엔드포인트는 백엔드에 미구현
- 예약 주문은 시스템이 자체 관리
- KIS API 구현 후 동기화 추가 가능

### 3. API 호출 빈도
- 자동 동기화: 1분마다
- KIS API 초당 거래 건수 제한 고려
- 필요시 `SYNC_INTERVAL` 조정 (현재 60000ms)

---

## ✅ 테스트 체크리스트

### 실전투자 계좌
- [x] 잔고 정상 표시 ($6.97)
- [x] 보유 포지션 표시
- [x] 거래내역 표시
- [x] 예약 주문 표시

### 모의투자 계좌
- [x] 잔고 정상 표시 (외화예수금 사용)
- [x] 보유 포지션 표시 (15개 종목)
- [x] 거래내역 표시 (BYND 2건)
- [x] 예약 주문 표시

### 동기화 기능
- [x] 자동 동기화 (1분마다)
- [x] 수동 동기화 (버튼 클릭)
- [x] 계좌 전환 시 데이터 갱신

---

## 🚀 다음 단계 (선택사항)

### 1. KIS API 거래내역 조회 구현
```typescript
// backend/src/kis-api-manager.ts
async getTradingHistory(startDate: string, endDate: string) {
  // TR ID: TTSC0404R (실전), VTSC0404R (모의)
  // 해외주식 주문체결내역 조회
}
```

### 2. KIS API 미체결 주문 조회 구현
```typescript
// backend/src/kis-api-manager.ts
async getUnexecutedOrders() {
  // TR ID: TTSC0408R (실전), VTSC0408R (모의)
  // 해외주식 미체결내역 조회
}
```

### 3. 동기화 서비스 확장
```typescript
// backend/src/kis-sync-service.ts
private async syncUnexecutedOrders() {
  // KIS API에서 미체결 조회
  // DB와 비교하여 상태 업데이트
}

private async syncTradingHistory() {
  // KIS API에서 오늘 거래내역 조회
  // DB와 비교하여 누락된 거래 추가
}
```

---

## 📝 최종 정리

### ✅ 해결된 문제
1. ✅ 모의투자 잔고 $0 표시 → 실제 매수 가능 금액 표시
2. ✅ 잔고 자동 갱신 (1분마다)
3. ✅ 수동 동기화 버튼 추가
4. ✅ 실전/모의 계좌별 데이터 분리

### 🎯 현재 동작
- **보유 포지션**: KIS API에서 실시간 조회
- **거래내역**: DB에서 조회 (시스템이 주문 실행 시 저장)
- **예약 주문**: DB에서 조회 (사용자가 예약 시 저장)
- **잔고**: KIS API에서 조회 + 캐싱 (1분마다 갱신)

### 📈 성능 최적화
- 캐싱 활용으로 불필요한 API 호출 감소
- 주기적 동기화로 데이터 최신 상태 유지
- 수동 동기화로 즉시 갱신 가능

