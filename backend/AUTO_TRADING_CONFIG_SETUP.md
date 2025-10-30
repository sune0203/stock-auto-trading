# 🤖 자동매수 설정 DB 구축 가이드

## 📋 개요

실전투자 모드에서 자동매수 설정(임계값, 익절/손절 비율)을 DB에 저장하고, 자동매수 실행 시 팝업 알림을 제공하는 시스템입니다.

---

## 🗄️ DB 테이블 생성

### 1. SQL 파일 실행

```bash
# MySQL 접속
mysql -h 116.122.37.82 -u nasdaq -p nasdaq

# SQL 파일 실행
source backend/sql/create_auto_trading_config.sql
```

### 2. 테이블 구조

```sql
CREATE TABLE _AUTO_TRADING_CONFIG (
  atc_id INT PRIMARY KEY AUTO_INCREMENT,
  atc_account_type VARCHAR(10) NOT NULL,           -- 계정 타입 (REAL/VIRTUAL)
  atc_enabled TINYINT(1) DEFAULT 0,                -- 자동매수 활성화 여부
  atc_bullish_threshold INT DEFAULT 70,            -- 긍정 점수 임계값
  atc_immediate_impact_threshold INT DEFAULT 70,   -- 즉시 영향 임계값
  atc_take_profit_percent DECIMAL(5,2) DEFAULT 5.00,   -- 익절 비율 (%)
  atc_stop_loss_percent DECIMAL(5,2) DEFAULT 3.00,     -- 손절 비율 (%)
  atc_max_investment_per_trade DECIMAL(10,2) DEFAULT 100.00,  -- 거래당 최대 투자금
  atc_max_daily_trades INT DEFAULT 10,             -- 하루 최대 거래 횟수
  atc_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atc_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_account (atc_account_type)
)
```

---

## 🔧 주요 기능

### 1. **설정 저장 및 로드**

#### 백엔드 API
- `GET /api/auto-trading/config`: 현재 계정의 자동매수 설정 조회
- `POST /api/auto-trading/config`: 설정 저장
- `POST /api/auto-trading/toggle`: 자동매수 ON/OFF

#### DB 함수
```typescript
// 설정 조회
const config = await getAutoTradingConfig('REAL')

// 설정 저장
await saveAutoTradingConfig({
  atc_account_type: 'REAL',
  atc_enabled: true,
  atc_bullish_threshold: 70,
  atc_immediate_impact_threshold: 70,
  atc_take_profit_percent: 5.0,
  atc_stop_loss_percent: 3.0,
  atc_max_investment_per_trade: 100.0,
  atc_max_daily_trades: 10
})

// ON/OFF 토글
await toggleAutoTrading('REAL', true)
```

---

### 2. **자동매수 알림 시스템**

#### 백엔드 (Socket.IO 이벤트 발송)
```typescript
// auto-trading.ts에서 자동매수 실행 후
io.emit('auto-buy-executed', {
  ticker: 'AAPL',
  price: 150.25,
  quantity: 10
})
```

#### 프론트엔드 (리스너 등록)
```typescript
useEffect(() => {
  const socket = (window as any).socket
  if (socket) {
    socket.on('auto-buy-executed', (data) => {
      // 알림 팝업 표시
      showAutoBuyNotification(data.ticker, data.price, data.quantity)
    })
  }
}, [])
```

---

## 🎨 UI 기능

### 1. **자동매수 설정 화면**

#### 설정 항목
- **매수 조건**
  - 호재 점수 임계값 (0 ~ 100%)
  - 즉시 영향 점수 임계값 (0 ~ 100%)

- **투자 금액**
  - 거래당 최대 투자 금액 ($)
  - 하루 최대 거래 횟수
  - 일일 최대 투자 금액 = 거래당 × 거래 횟수

- **익절/손절**
  - 익절 비율 (%)
  - 손절 비율 (%)

### 2. **알림 팝업**

자동매수가 실행되면 다음과 같은 팝업이 표시됩니다:

```
┌───────────────────────────────────┐
│                                   │
│  🤖 자동매수 완료:                  │
│  AAPL 10주 @ $150.25              │
│                                   │
│          [ 확인 ]                  │
│                                   │
└───────────────────────────────────┘
```

- 5초 후 자동으로 사라짐
- 확인 버튼 클릭 시 즉시 닫힘

---

## 🔄 데이터 흐름

### 설정 저장
```
프론트엔드 (설정 저장 클릭)
  ↓
POST /api/auto-trading/config
  ↓
saveAutoTradingConfig() → MySQL
  ↓
autoTradingService.setConfig() (메모리 반영)
  ↓
프론트엔드 (✅ 설정이 저장되었습니다)
```

### 자동매수 실행
```
autoTradingService (뉴스 감지)
  ↓
조건 충족 (점수 임계값, 투자금액 등)
  ↓
자동 매수 실행
  ↓
Socket.IO 이벤트 발송: 'auto-buy-executed'
  ↓
프론트엔드 리스너 감지
  ↓
알림 팝업 표시
```

---

## 📊 기본값

| 설정 항목 | 기본값 |
|----------|--------|
| 호재 점수 임계값 | 70% |
| 즉시 영향 임계값 | 70% |
| 거래당 최대 투자금 | $100 |
| 하루 최대 거래 횟수 | 10회 |
| 익절 비율 | 5% |
| 손절 비율 | 3% |

---

## ✅ 체크리스트

- ✅ DB 테이블 생성 (`_AUTO_TRADING_CONFIG`)
- ✅ 백엔드 DB 함수 구현
- ✅ 백엔드 API 엔드포인트 수정
- ✅ 프론트엔드 설정 UI 수정 (필드명 변경)
- ✅ Socket.IO 자동매수 이벤트 추가
- ✅ 알림 팝업 UI 추가
- ✅ CSS 스타일링 완료

---

## 🚀 사용 방법

1. **DB 테이블 생성**
   ```bash
   mysql -h 116.122.37.82 -u nasdaq -p nasdaq < backend/sql/create_auto_trading_config.sql
   ```

2. **백엔드 재시작**
   ```bash
   cd backend
   npm run dev
   ```

3. **프론트엔드 새로고침**
   - 자동매수 설정 팝업 열기
   - 임계값, 투자금액, 익절/손절 비율 설정
   - "💾 설정 저장" 클릭

4. **자동매수 ON**
   - TradingPage에서 "자동매수 ON" 활성화
   - 설정된 조건에 맞는 뉴스 감지 시 자동 매수
   - 매수 완료 시 팝업 알림 표시

---

**이제 실전투자 모드에서 자동매수 설정이 DB에 저장되고, 매수 실행 시 알림 팝업이 표시됩니다!** 🎉

