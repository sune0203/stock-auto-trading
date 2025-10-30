# 나스닥 급등주 실시간 감지 시스템

FMP API를 활용한 실전용 나스닥 동전주 급등 패턴 자동 탐지 및 추적 시스템

## 🔥 최신 업데이트

### ✅ 가격 추적 시스템 개선 (2025.10.30)
- FMP quote API 개별 호출 방식으로 변경 (배치 미지원 대응)
- 병렬 처리로 성능 최적화 (5개씩 동시 처리)
- 에러 핸들링 강화 (일부 실패해도 계속 진행)
- 시세 조회 성공률 로그 표시

### ✅ UI 대폭 개선
- 차트 빈 영역에 감지 목록 카드 그리드 표시
- 각 카드 클릭 시 차트 자동 표시
- 종목별 추적 중지 버튼 추가
- 30초마다 자동 갱신
- SEC 공시 배지 표시
- 점수 및 감지 이유 상세 표시

### 📚 문서화 강화
- `SCAN_GUIDE.md`: 각 스캔 타입 동작 상세 설명
- 실제 로그 기반 분석 및 문제 해결 가이드
- 시간대별 추천 전략

---

## 주요 기능

### 🎯 핵심 기능
- **실시간 급등 패턴 감지**: 거래량, 기술적 지표, SEC 공시 등을 종합 분석
- **프리마켓/정규장/애프터마켓 추적**: 모든 세션의 가격 변동 실시간 모니터링
- **WebSocket 실시간 알림**: 감지 즉시 웹 팝업 및 플로팅 버튼 알림
- **가격 추적 차트**: 감지 시점부터 현재까지 가격 변동 시각화

### 📊 감지 기준
1. **거래량 급증** (20일 평균 대비 1.5배 이상)
2. **볼린저밴드 스퀴즈** (변동성 압축 패턴)
3. **가격 보합 매집** (±3% 이내 안정적 움직임)
4. **골든크로스** (5일선이 20일선 상향 돌파)
5. **낮은 유통량** (Float < 2000만 주)
6. **SEC 공시 이벤트** (8-K, S-1 등 최근 2일 이내)

## 프로젝트 구조

```
filter-detector/
├── backend/              # Node.js + TypeScript 백엔드
│   ├── src/
│   │   ├── config.ts            # 설정 관리
│   │   ├── types.ts             # 타입 정의
│   │   ├── database.ts          # MySQL 데이터베이스
│   │   ├── fmp-client.ts        # FMP API 클라이언트
│   │   ├── sec-monitor.ts       # SEC 공시 모니터
│   │   ├── technical-indicators.ts  # 기술적 지표 계산
│   │   ├── surge-scanner.ts     # 급등주 스캐너
│   │   ├── price-tracker.ts     # 가격 추적 서비스
│   │   ├── websocket-server.ts  # WebSocket 서버
│   │   └── server.ts            # Express API 서버
│   ├── package.json
│   └── tsconfig.json
│
└── frontend/             # React + TypeScript 프론트엔드
    ├── src/
    │   ├── components/          # React 컴포넌트
    │   │   ├── FloatingAlert.tsx      # 플로팅 알림 버튼
    │   │   ├── DetectionPopup.tsx     # 감지 알림 팝업
    │   │   ├── DetectionList.tsx      # 감지 목록
    │   │   ├── PriceChart.tsx         # 가격 차트
    │   │   └── ScannerControl.tsx     # 스캐너 제어
    │   ├── services/
    │   │   ├── api.ts               # REST API 서비스
    │   │   └── websocket.ts         # WebSocket 서비스
    │   ├── hooks/
    │   │   └── useWebSocket.ts      # WebSocket 훅
    │   ├── types/
    │   │   └── index.ts             # 타입 정의
    │   ├── App.tsx
    │   └── main.tsx
    ├── package.json
    └── vite.config.ts
```

## 설치 및 실행

### 1. 백엔드 설치 및 실행

```bash
cd filter-detector/backend

# 패키지 설치
npm install

# 개발 모드 실행
npm run dev

# 또는 빌드 후 실행
npm run build
npm start
```

백엔드는 다음 포트에서 실행됩니다:
- **API 서버**: http://localhost:3005
- **WebSocket**: ws://localhost:3006

### 2. 프론트엔드 설치 및 실행

```bash
cd filter-detector/frontend

# 패키지 설치
npm install

# 개발 모드 실행
npm run dev
```

프론트엔드는 http://localhost:3000 에서 실행됩니다.

## 환경 설정

백엔드 `src/config.ts` 파일에 다음 정보가 설정되어 있습니다:

```typescript
db: {
  host: '116.122.37.82',
  user: 'nasdaq',
  password: 'core1601!',
  database: 'nasdaq',
  port: 3306,
}

fmp: {
  apiKey: 'Nz122fIiH3KWDx8UVBdQFL8a5NU9lRhc',
}
```

## 사용 방법

### 1. 자동 스캔
- 백엔드 시작 시 자동으로 5분마다 활성 거래 종목 스캔
- 설정은 `/api/scanner/config` API로 변경 가능

### 2. 수동 스캔
프론트엔드에서 **스캐너 제어** 패널 사용:
- **🚀 최대 상승 종목 (추천)**: FMP API의 Biggest Gainers에서 나스닥 $10 이하 종목 스캔
- **🔥 최대 거래량 종목**: FMP API의 Most Actives에서 나스닥 $10 이하 종목 스캔
- **활성 거래 종목**: 거래량이 높은 종목 스캔
- **나스닥 동전주**: 가격 $5 이하 동전주 스캔
- **커스텀 심볼**: 특정 종목 지정 스캔

### 3. 실시간 알림
- 급등 가능성 감지 시 **팝업 알림** 자동 표시
- **플로팅 버튼** 깜빡이며 새 감지 카운트 표시
- 클릭하면 감지 목록 표시/숨김

### 4. 가격 추적
- 감지된 종목은 자동으로 추적 시작
- 프리마켓/정규장/애프터마켓 모든 세션 데이터 수집
- 차트로 실시간 가격 변동 시각화
- 추적 중지 버튼으로 종료 가능

## API 엔드포인트

### 감지 관련
- `GET /api/detections` - 감지 목록 조회
- `GET /api/detections/active` - 추적 중인 감지 목록
- `GET /api/detections/:id/history` - 가격 히스토리
- `POST /api/detections/:id/stop` - 추적 중지

### 스캔 관련
- `POST /api/scan/manual` - 수동 스캔 실행
- `POST /api/scan/symbol` - 단일 종목 분석

### 설정 관련
- `GET /api/scanner/config` - 스캐너 설정 조회
- `PUT /api/scanner/config` - 스캐너 설정 업데이트

### 시장 정보
- `GET /api/market/status` - 현재 시장 상태
- `GET /api/price/:symbol` - 실시간 가격 조회

## WebSocket 이벤트

클라이언트가 수신하는 이벤트:

```typescript
// 새로운 급등 감지
{
  type: 'detection',
  data: DetectionResult,
  timestamp: Date
}

// 가격 업데이트
{
  type: 'price_update',
  data: PriceTrackHistory,
  timestamp: Date
}

// 스캔 완료
{
  type: 'scan_complete',
  data: { detectionCount, totalScanned, scanTime },
  timestamp: Date
}
```

## 데이터베이스 스키마

### surge_detections (감지 결과)
- 감지된 급등 가능성 종목 정보
- 점수, 이유, 기술적 지표 등

### price_track_history (가격 추적)
- 감지 후 실시간 가격 변동 기록
- 세션별 가격, 거래량, 변동률

### scanner_configs (스캐너 설정)
- 자동 스캔 설정
- 활성화 여부, 최소 점수, 스캔 간격

## 📊 실전 특화 기능

- ✅ **프리마켓/애프터마켓 배치 추적** - FMP `batch-aftermarket-trade` API로 여러 종목 동시 조회
- ✅ **가격 변동률 스마트 필터링** - `stock-price-change` API로 1D, 5D, 1M 등 기간별 상승률 분석
- ✅ **SEC 공시 3중 체크** - FMP API + EDGAR Atom + EDGAR RSS 동시 확인
- ✅ **배치 처리 최적화** - 여러 종목을 한 번에 효율적으로 조회 (API 호출 최소화)
- ✅ **세션별 자동 전환** - 프리마켓/정규장/애프터마켓 자동 감지 및 적절한 API 호출
- ✅ **자동 정기 스캔** - 5분마다 실행 (설정 변경 가능)
- ✅ **MySQL 데이터 저장** - 모든 감지 및 추적 기록 보관
- ✅ **WebSocket 실시간 통신** - 지연 없는 알림

## 기술 스택

### 백엔드
- Node.js + TypeScript
- Express (REST API)
- WebSocket (실시간 통신)
- MySQL (데이터 저장)
- Axios (HTTP 클라이언트)
- node-cron (스케줄링)

### 프론트엔드
- React 18 + TypeScript
- Vite (빌드 도구)
- Recharts (차트 라이브러리)
- Axios (HTTP 클라이언트)
- WebSocket (실시간 통신)

## 라이센스

이 프로젝트는 실전용으로 제작되었습니다.

