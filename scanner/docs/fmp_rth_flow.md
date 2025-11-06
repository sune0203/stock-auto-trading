# FMP API 기반 정규장(RTH) 스캐너 개발 플로우

## 개요

이 문서는 FMP (Financial Modeling Prep) API를 사용하여 정규장(Regular Trading Hours) 전용 초단타 스캐너를 구축하는 과정을 설명합니다.

## 전체 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                   데이터 소스                            │
│  FMP API (Profile, Quote, 1min, Daily Historical)      │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│                  오프라인 처리                           │
│  1. Scanner      → watchlist.json                       │
│  2. Features     → offline_features.parquet             │
│  3. Training     → model + stats                        │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│               실시간 서버 (FastAPI)                      │
│  - FMP 폴링 (5초 간격)                                  │
│  - 피처 계산 및 신호 생성                                │
│  - WebSocket 브로드캐스트                               │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│                클라이언트 (브라우저)                      │
│  - WebSocket 연결                                       │
│  - 실시간 신호 수신                                      │
│  - 차트/대시보드 표시                                    │
└─────────────────────────────────────────────────────────┘
```

## 주요 컴포넌트

### 1. Utils (유틸리티 모듈)

#### universe.py
- **역할**: 거래소 마스터 파일에서 종목 심볼 추출
- **입력**: `data/*.txt` (AMEX, NASDAQ, NYSE)
- **출력**: 정렬된 심볼 리스트

#### fmp_api.py
- **역할**: FMP API 호출 래퍼
- **주요 함수**:
  - `get_profile()`: 종목 프로필 (시가총액 등)
  - `get_quote()`: 현재가
  - `get_hist_daily()`: 일봉 히스토리
  - `get_hist_1min()`: 1분봉 히스토리

#### metrics.py
- **역할**: 기술적 지표 계산
- **구현 지표**:
  - ATR (Average True Range)
  - RVOL (Relative Volume)
  - Spread (호가 스프레드 추정)

### 2. Offline (오프라인 처리)

#### scanner.py
- **역할**: 전체 유니버스에서 패턴형 종목 발굴
- **필터 조건**:
  - 주가: $0.3 ~ $15
  - 시가총액: $20M ~ $1.5B
  - ATR5 >= 5%
  - 변동성 조건
- **출력**: `watchlist.json`

#### features_offline.py
- **역할**: 과거 데이터로 피처/라벨 생성
- **피처**:
  - `rvol_1m`: 1분 상대 거래량
  - `base_range`: 베이스 범위 (30분 박스)
  - `spread_est`: 스프레드 추정
  - `move_prev`: 이전 대비 변화율
- **라벨**: MFE/MAE 기반 (30m, 60m)
- **출력**: `offline_features.parquet`

#### train_daily.py
- **역할**: LightGBM 모델 학습
- **입력**: `offline_features.parquet`
- **출력**:
  - `model_lgbm_30m.bin`: 학습된 모델
  - `symbol_stats.json`: 티커별 통계

### 3. Server (실시간 서버)

#### feature_live.py
- **역할**: 실시간 피처 계산
- **방식**: FMP API에서 최근 3시간 분봉 가져오기
- **계산**: RVOL, base_range, spread

#### server.py
- **역할**: FastAPI + WebSocket 서버
- **엔드포인트**:
  - `GET /`: 헬스체크
  - `GET /watchlist`: 감시 종목 리스트
  - `WS /ws`: WebSocket 실시간 신호
- **모니터링 루프**:
  - 5초마다 watchlist 종목 체크
  - 진입 조건 만족 시 신호 브로드캐스트

## 데이터 플로우

### 오프라인 단계

```
1. universe.py
   └─> AMEX/NASDAQ/NYSE 심볼 리스트

2. scanner.py
   ├─> get_profile() : 시가총액 체크
   ├─> get_hist_daily() : ATR, 변동성 체크
   ├─> get_hist_1min() : RVOL, 스프레드 체크
   └─> watchlist.json : 스코어 >= 70 종목

3. features_offline.py
   ├─> watchlist.json 로드
   ├─> get_hist_1min() : 각 종목 120일치
   ├─> 피처 계산 (RVOL, base_range, spread, move)
   ├─> 라벨 계산 (MFE/MAE)
   └─> offline_features.parquet

4. train_daily.py
   ├─> offline_features.parquet 로드
   ├─> LightGBM 학습
   ├─> 검증 (AUC, 분류 리포트)
   └─> model_lgbm_30m.bin + symbol_stats.json
```

### 실시간 단계

```
server.py
├─> watchlist.json 로드
│
├─> monitor_loop (5초마다)
│   ├─> 각 종목별로:
│   │   ├─> feature_live.py : get_hist_1min(180분)
│   │   ├─> 피처 계산 (RVOL, base_range, spread)
│   │   ├─> 진입 조건 체크
│   │   │   - RVOL >= 2.0
│   │   │   - base_range <= 6%
│   │   │   - 1분 전 대비 +3%
│   │   └─> 조건 만족 시:
│   │       └─> broadcast() : WebSocket 신호 전송
│   └─> 5초 대기
│
└─> WebSocket /ws
    └─> 클라이언트들에게 신호 브로드캐스트
```

## 진입 신호 구조

WebSocket으로 전송되는 신호 페이로드:

```json
{
  "t": "2025-11-05T12:34:56.789Z",
  "session": "RTH",
  "symbol": "ABCD",
  "state": "RePump",
  "price": 5.67,
  "vwap": 5.60,
  "rvol_1m": 3.2,
  "base_range_pct": 4.5,
  "spread_pct": 1.1,
  "move_pct": 3.8,
  "score": null,
  "thr": null,
  "rules_used": {
    "gap_min": 0.08,
    "rvol_min": 2.0,
    "spread_max": 0.012,
    "cooldown_min": 15
  }
}
```

## 설정 파라미터

### 스캐너 필터 (scanner.py)

```python
CFG = {
    "price_min": 0.3,           # 최소 주가
    "price_max": 15.0,          # 최대 주가
    "mcap_min": 20_000_000,     # 최소 시가총액
    "mcap_max": 1_500_000_000,  # 최대 시가총액
    "min_score": 70,            # 최소 점수
}
```

### 피처/라벨 설정 (features_offline.py)

```python
CFG = {
    "lookback_days": 120,       # 과거 데이터 기간
    "label_windows": [30, 60],  # 라벨 윈도우 (분)
    "label_up": 0.04,           # 상승 목표: +4%
    "label_down": -0.015,       # 하락 허용: -1.5%
}
```

## API 레이트 리밋 고려사항

### FMP API 제한

| 플랜 | 요청 제한 | 적합성 |
|------|----------|--------|
| Free | 250 req/day | 테스트만 가능 |
| Starter | 750 req/day | 제한적 사용 |
| Professional | 제한 완화 | 실운영 권장 |

### 최적화 전략

1. **스캐너**: 
   - 필터 조건을 엄격하게 → API 호출 감소
   - 캐싱 활용

2. **실시간 서버**:
   - 폴링 간격 조정 (5초 → 10초)
   - watchlist 크기 제한 (50개)

3. **피처 생성**:
   - 배치 처리
   - 하루 1회 실행

## 성능 최적화

### 병렬 처리

```python
# 스캐너에서 멀티스레딩 사용 (선택사항)
from concurrent.futures import ThreadPoolExecutor

with ThreadPoolExecutor(max_workers=5) as executor:
    results = list(executor.map(pattern_score, universe))
```

### 캐싱

```python
# 일별 데이터 캐싱
from functools import lru_cache

@lru_cache(maxsize=1000)
def get_hist_daily_cached(symbol: str, date: str):
    return get_hist_daily(symbol)
```

## 트러블슈팅

### 문제 1: API 호출 실패

**원인**: 레이트 리밋 초과 또는 잘못된 API 키

**해결**:
```python
# 재시도 로직 추가
import time
from requests.exceptions import RequestException

def safe_api_call(func, *args, max_retries=3):
    for i in range(max_retries):
        try:
            return func(*args)
        except RequestException as e:
            if i < max_retries - 1:
                time.sleep(2 ** i)  # 지수 백오프
            else:
                raise
```

### 문제 2: 데이터 품질

**원인**: FMP 1분봉 데이터 누락 또는 부정확

**해결**:
- 데이터 검증 로직 추가
- 여러 소스 결합 (Polygon, Alpha Vantage)

### 문제 3: 서버 성능

**원인**: 많은 종목 동시 모니터링

**해결**:
- watchlist 크기 제한
- 비동기 처리 활용
- 멀티프로세싱

## 다음 단계

1. **실시간 개선**
   - Polygon WebSocket 통합
   - 실시간 스트리밍 (폴링 대신)

2. **세션 분리**
   - 프리마켓 (PRE): 04:00-09:30 ET
   - 정규장 (RTH): 09:30-16:00 ET
   - 애프터마켓 (POST): 16:00-20:00 ET

3. **UI/UX**
   - Next.js 대시보드
   - TradingView 차트 통합
   - 알림 시스템

4. **자동화**
   - Docker 컨테이너화
   - 스케줄러 (매일 자동 학습)
   - 클라우드 배포

## 참고 자료

- FMP API 문서: https://site.financialmodelingprep.com/developer/docs
- LightGBM 문서: https://lightgbm.readthedocs.io/
- FastAPI 문서: https://fastapi.tiangolo.com/

