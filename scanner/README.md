# FMP API 기반 정규장 초단타 스캐너

FMP (Financial Modeling Prep) API를 사용한 정규장 패턴형 종목 스캐너 시스템입니다.

## 📋 목차

- [프로젝트 구조](#프로젝트-구조)
- [설치 및 설정](#설치-및-설정)
- [사용 방법](#사용-방법)
- [주요 기능](#주요-기능)

## 📁 프로젝트 구조

```
scanner/
├─ .env.template          # 환경변수 템플릿
├─ requirements.txt       # 파이썬 의존성
├─ README.md             # 이 파일
│
├─ data/                 # 데이터 저장 디렉토리 (자동 생성)
│   ├─ watchlist.json           # 스캐너 결과
│   ├─ offline_features.parquet # 피처/라벨 데이터
│   ├─ model_lgbm_30m.bin       # 학습된 모델
│   └─ symbol_stats.json        # 티커별 통계
│
├─ utils/                # 유틸리티 모듈
│   ├─ universe.py       # 종목 마스터 로더
│   ├─ fmp_api.py        # FMP API 클라이언트
│   └─ metrics.py        # 기술적 지표 (ATR, RVOL 등)
│
├─ offline/              # 오프라인 처리
│   ├─ scanner.py        # (1) 종목 발굴
│   ├─ features_offline.py # (2) 피처/라벨 생성
│   └─ train_daily.py    # (3) 모델 학습
│
└─ server/               # 실시간 서버
    ├─ feature_live.py   # 실시간 피처 계산
    └─ server.py         # FastAPI + WebSocket 서버
```

## ⚙️ 설치 및 설정

### 1. 가상환경 생성 (선택사항)

```bash
cd C:\dev\chart-core\scanner
python -m venv .venv
.\.venv\Scripts\activate
```

### 2. 의존성 설치

```bash
pip install -r requirements.txt
```

### 3. 환경변수 설정

`.env.template`을 `.env`로 복사하고 FMP API 키를 설정합니다:

```bash
copy .env.template .env
```

`.env` 파일을 편집:
```env
FMP_API_KEY=여기에_실제_FMP_API_키_입력
TZ_UI=Asia/Seoul
```

> **FMP API 키 발급**: https://site.financialmodelingprep.com/developer/docs

### 4. 종목 마스터 파일 확인

프로젝트 루트의 `data/` 디렉토리에 다음 파일들이 있어야 합니다:
- `C:\dev\chart-core\data\amsmst.txt` (AMEX)
- `C:\dev\chart-core\data\nasmst.txt` (NASDAQ)
- `C:\dev\chart-core\data\nysmst.txt` (NYSE)

## ⚡ 빠른 시작 (웹 UI)

### 1. 설정 테스트 및 테스트 Watchlist 생성

```bash
cd C:\dev\chart-core\scanner
python test_setup.py
```

### 2. 서버 실행

```bash
python server/server.py
```

### 3. 브라우저에서 접속

```
http://localhost:8000
```

**💡 상세 가이드**: [QUICKTEST.md](QUICKTEST.md)

---

## 🚀 전체 사용 방법

### Step 1: 종목 스캐닝

전체 유니버스에서 패턴형 종목을 발굴합니다:

```bash
python offline/scanner.py
```

**결과**: `data/watchlist.json` 생성 (스코어 순으로 정렬된 종목 리스트)

**필터 조건**:
- 주가: $0.3 ~ $15
- 시가총액: $20M ~ $1.5B
- ATR5 >= 5%
- 큰 변동 (±20%) 1회 이상
- RVOL 피크 >= 2.0
- 스프레드 <= 2%

### Step 2: 피처/라벨 생성

watchlist 종목들의 과거 데이터로 피처와 라벨을 생성합니다:

```bash
python offline/features_offline.py
```

**결과**: `data/offline_features.parquet` 생성

**생성 항목**:
- 피처: `rvol_1m`, `base_range`, `spread_est`, `move_prev`
- 라벨: `label_30m`, `label_60m` (MFE/MAE 기반)

### Step 3: 모델 학습

LightGBM 분류 모델을 학습합니다:

```bash
python offline/train_daily.py
```

**결과**:
- `data/model_lgbm_30m.bin` - 학습된 모델
- `data/symbol_stats.json` - 티커별 성공 통계

### Step 4: 실시간 서버 실행

FastAPI + WebSocket 서버를 시작합니다:

```bash
python server/server.py
```

**서버 정보**:
- 웹 대시보드: `http://localhost:8000`
- API 상태: `http://localhost:8000/api`
- Watchlist: `http://localhost:8000/watchlist`
- WebSocket: `ws://localhost:8000/ws`
- API 문서: `http://localhost:8000/docs`

**모니터링**:
- watchlist 종목들을 5초마다 체크
- 진입 조건 만족 시 WebSocket으로 신호 브로드캐스트
- 웹 대시보드에서 실시간 확인 가능

**웹 UI 가이드**: [README_WEB.md](README_WEB.md)

## 🎯 주요 기능

### 스캐너 (scanner.py)

- 전체 유니버스(AMEX + NASDAQ + NYSE) 스캔
- 다중 조건 필터링 (가격, 시가총액, 변동성)
- 점수 기반 랭킹 시스템

**점수 구성**:
- ATR5 >= 8%: 30점
- 큰 변동 3회 이상: 25점
- RVOL 피크 >= 3.0: 25점
- 스프레드 <= 1.2%: 20점
- **최소 70점 이상**만 통과

### 피처 생성 (features_offline.py)

- 1분봉 기반 피처 계산
- MFE/MAE 라벨링 (30분, 60분)
- 성공 조건: MFE >= +4% AND MAE >= -1.5%

### 실시간 서버 (server.py)

- FMP API 폴링 방식 (5초 간격)
- WebSocket 실시간 신호 전송
- 진입 조건:
  - RVOL >= 2.0
  - 베이스 범위 <= 6%
  - 1분 전 대비 +3% 이상

## 📊 데이터 흐름

```
1. scanner.py
   └─> watchlist.json (발굴된 종목)

2. features_offline.py
   └─> offline_features.parquet (피처/라벨)

3. train_daily.py
   ├─> model_lgbm_30m.bin (모델)
   └─> symbol_stats.json (통계)

4. server.py
   └─> WebSocket (실시간 신호)
```

## 📚 문서

- **README.md** - 프로젝트 전체 개요 및 사용법 (이 문서)
- **QUICKTEST.md** - ⚡ 웹 UI 빠른 테스트 (30초 시작)
- **QUICKSTART.md** - 5분 빠른 시작 가이드
- **INSTALL.md** - 상세 설치 및 트러블슈팅
- **README_WEB.md** - 웹 대시보드 사용 가이드
- **docs/fmp_rth_flow.md** - 아키텍처 및 데이터 플로우

## 🔧 테스트

각 모듈은 독립적으로 테스트 가능합니다:

```bash
# Universe 로더 테스트
python utils/universe.py

# FMP API 테스트
python utils/fmp_api.py

# Metrics 테스트
python utils/metrics.py

# 실시간 피처 테스트
python server/feature_live.py
```

## ⚠️ 주의사항

1. **FMP API 레이트 리밋**
   - Free 플랜: 250 requests/day
   - Starter 플랜: 750 requests/day
   - 전체 스캔 시 많은 요청이 발생하므로 유료 플랜 권장

2. **데이터 품질**
   - 1분봉 데이터는 최근 일부만 제공됨
   - 프리마켓/애프터마켓 데이터 포함 가능

3. **성능**
   - 전체 유니버스 스캔은 시간이 오래 걸림 (수천 종목)
   - 초기 테스트 시 일부 종목만 사용 권장

## 🔄 향후 확장

- [x] 웹 대시보드 UI (완료!)
- [ ] Polygon WebSocket 통합 (실시간 스트리밍)
- [ ] 프리/애프터 마켓 지원
- [ ] Docker 컨테이너화
- [ ] 자동 스케줄링 (cron/scheduler)
- [ ] TradingView 차트 통합
- [ ] 모바일 반응형 개선

## 📝 라이센스

이 프로젝트는 개인 용도로 제작되었습니다.

## 🤝 기여

버그 리포트나 기능 제안은 이슈로 등록해주세요.

