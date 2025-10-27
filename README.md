# 🤖 GlobeNewswire AI 자동 매매 시스템

GlobeNewswire의 뉴스를 실시간으로 모니터링하고 Gemini API를 사용하여 나스닥 상장 여부, 티커, 호재/악재를 분석합니다.
**호재 점수 90% 이상일 때 자동매매, 80-89%일 때 수동매매 신호 (현 잔고의 10% 매수), -10% 손절 / +10% 익절로 자동 매도**하는 완전 자동화 트레이딩 시스템입니다.

## 빠른 시작

```powershell
# 1. 의존성 설치
cd frontend ; npm install
cd ../backend ; npm install
cd ../scraper ; pip install -r requirements.txt

# 2. Gemini API 키 설정
# scraper/scraper.py 파일에서 GEMINI_API_KEY 수정

# 3. 실행 (3개 터미널)
# 터미널 1:
cd backend ; npm run dev

# 터미널 2:
cd frontend ; npm run dev

# 터미널 3:
cd scraper ; python scraper.py

# 4. 브라우저 접속: http://localhost:3000

# 5. 자동 매매 대시보드
# - 우측 하단 "🤖 자동매매" 버튼 클릭
# - 테스트 모드 확인 (기본 활성화)
# - 자동매매 활성화 체크
```

## 🧪 테스트 방법

**안전하게 테스트하려면:**
1. 브라우저에서 http://localhost:3000 접속
2. 우측 하단 **🤖 자동매매** 버튼 클릭
3. **🧪 테스트 모드** 체크박스 확인 (기본 켜짐)
4. **✅ 자동매매 활성화** 체크박스 켜기
5. 뉴스 스크랩 대기 → 호재 뉴스 감지 시 자동 매수 시뮬레이션
6. **📊 보유 포지션** 탭에서 실시간 손익 확인
7. **📜 거래 기록** 탭에서 매수/매도 내역 확인

**자세한 내용**: [TESTING_GUIDE.md](./TESTING_GUIDE.md) 참고

> ⚠️ **주의**: 테스트 모드에서는 실제 주문이 실행되지 않습니다. 실전 모드로 전환 시 실제 계좌에서 거래됩니다!
```

## ⭐ 주요 기능

1. **실시간 뉴스 모니터링** - GlobeNewswire 2초 간격 스크랩 (최대 40개)
2. **AI 분석** - Gemini API로 나스닥 상장 여부, 티커, 호재/악재 점수 분석
3. **자동 매수** - 호재 점수 90% 이상 시 자동매매, 80-89% 시 수동매매 신호 (현 잔고의 10%)
4. **자동 매도** - -10% 손절, +10% 익절 자동 실행
5. **리스크 관리** - 호재 발생 시 현 잔고의 10%만 매수하여 리스크 분산
6. **실시간 대시보드** - 보유 포지션, 손익, 거래 기록 실시간 확인
7. **테스트 모드** - 실제 주문 없이 매매 로직 시뮬레이션 (기본값)

## 기술 스택

- **Frontend**: React + TypeScript + Vite + Socket.IO Client
- **Backend**: Node.js + Express + Socket.IO + 한국투자증권 API
- **Scraper**: Python + Selenium + Gemini API
- **Trading**: 한국투자증권 모의투자 API

## 프로젝트 구조

```
chart-core/
├── frontend/                 # React 프론트엔드
│   ├── src/
│   │   ├── components/
│   │   │   ├── NewsCard.tsx
│   │   │   ├── NewsCard.css
│   │   │   ├── NewsFeed.tsx
│   │   │   └── NewsFeed.css
│   │   ├── App.tsx
│   │   ├── App.css
│   │   ├── main.tsx
│   │   ├── types.ts
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── backend/                  # Node.js 백엔드
│   ├── src/
│   │   ├── server.ts
│   │   └── types.ts
│   ├── package.json
│   └── tsconfig.json
│
├── scraper/                  # Python 스크래퍼
│   ├── scraper.py
│   ├── requirements.txt
│   └── env.example
│
├── install.ps1               # 자동 설치 스크립트
├── start.ps1                 # 자동 실행 스크립트
├── package.json
├── README.md
└── USAGE.md                  # 상세 사용 가이드
```

## 설치 방법

#### 1. 전체 의존성 설치

```powershell
# 루트에서 모든 패키지 설치
npm run install:all
```

또는 개별 설치:

```powershell
# 루트 패키지
npm install

# 프론트엔드
cd frontend ; npm install

# 백엔드
cd backend ; npm install

# 스크래퍼 (Python)
cd scraper ; pip install -r requirements.txt
```

#### 2. 환경 변수 설정

`scraper/.env` 파일 생성:

```env
GEMINI_API_KEY=your_gemini_api_key_here
BACKEND_URL=http://localhost:3001
```

[Gemini API Key 발급](https://makersuite.google.com/app/apikey)

#### 3. Chrome WebDriver 설치

Selenium 사용을 위해 Chrome과 ChromeDriver가 필요합니다.
최신 Chrome 브라우저를 사용하면 자동으로 ChromeDriver가 관리됩니다.

## 실행 방법

터미널 3개를 열어서:

```powershell
# 터미널 1: 백엔드
cd backend ; npm run dev

# 터미널 2: 프론트엔드
cd frontend ; npm run dev

# 터미널 3: 스크래퍼
cd scraper ; python scraper.py
```

## 접속

- **프론트엔드**: http://localhost:3000
- **백엔드**: http://localhost:3001

## 자동 매매 설정

### 기본 설정
- **호재 점수**: 90점 이상
- **손절**: -10%
- **익절**: +10%
- **최대 포지션**: $1,000
- **모니터링 주기**: 5분

### 사용 방법
1. 프론트엔드 우측 하단 "🤖 자동매매" 버튼 클릭
2. "자동매매 활성화" 체크박스 선택
3. 나스닥 호재 뉴스 발생 시 자동 매수 시작
4. 포지션 패널에서 실시간 손익 확인

### API 설정
- **증권사**: 한국투자증권 모의투자
- **계좌번호**: 50155467
- **거래소**: NASDAQ
- **주문 방식**: 시장가 주문

## 주요 기능

1. **실시간 뉴스 모니터링**
   - GlobeNewswire 웹사이트를 10초마다 체크
   - 새 뉴스 발생 시 자동 감지

2. **Gemini AI 분석**
   - 나스닥 상장 종목 여부 판별
   - 티커 심볼 추출
   - 호재/악재 분석 및 비율 계산
   - 한국어 번역

3. **실시간 UI 업데이트**
   - WebSocket을 통한 실시간 뉴스 표시
   - 언어 전환 (한국어/영어)
   - 시각적 감성 분석 바

## API 엔드포인트

### Backend

- `POST /api/news` - 스크래퍼로부터 새 뉴스 수신
- `GET /api/health` - 헬스체크

### WebSocket 이벤트

- `news:new` - 새 뉴스 알림
- `news:initial` - 초기 뉴스 목록

## 문제 해결

### Selenium 오류
- ChromeDriver 버전이 Chrome 브라우저 버전과 일치하는지 확인
- Headless 모드가 작동하지 않으면 scraper.py에서 `--headless` 제거

### Gemini API 오류
- API 키가 올바른지 확인
- API 할당량 확인
- .env 파일 경로 확인

### WebSocket 연결 오류
- 백엔드가 실행 중인지 확인
- CORS 설정 확인
- 포트 충돌 확인 (3000, 3001)

## 추가 문서

- [USAGE.md](USAGE.md) - 상세 사용 가이드
- [DEMO.md](DEMO.md) - 데모 및 테스트 가이드

## 스크린샷

### 메인 화면

제공하신 캡처 이미지와 동일한 UI:
- 좌측: 뉴스 피드 제목
- 우측: 언어 선택 및 연결 상태
- 뉴스 카드: 지역, 시간, 제목, 설명, 호재/악재 분석

### 주요 기능

- 실시간 뉴스 업데이트 (WebSocket)
- AI 기반 나스닥 상장 여부 판별
- 티커 심볼 자동 추출
- 호재/악재 분석 및 시각화
- 한국어/영어 자동 번역

## 라이선스

MIT

