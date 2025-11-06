# chart-core: FMP API 기반 정규장 초단타 시스템 구축 가이드

> **목표**  
> - 먼저 **정규장(RTH)** 만 FMP API로 구축  
> - 이후 Polygon, 프리/애프터, Next.js 등은 2단계로 확장  
> - `C:\dev\chart-core` 기준, **Cursor 에서 위에서 아래로 순차 개발**할 수 있게 정리

---

## 0. 전제 / 준비

- 루트 디렉토리: `C:\dev\chart-core`
- 거래소 종목 마스터 파일(이미 보유)
  - `C:\dev\chart-core\data\amsmst.txt` (AMEX)
  - `C:\dev\chart-core\data\nasmst.txt` (NASDAQ)
  - `C:\dev\chart-core\data\nysmst.txt` (NYSE)
- 우선은 **정규장 + FMP API**만 사용
  - 프리/애프터, Polygon, WebSocket 스트림, Next.js 대시보드는 **나중 단계**

---

## 1. 디렉토리 구조 설계

루트 폴더에 아래 구조를 맞춰갑니다.

```text
C:\dev\chart-core\
  ├─ .env
  ├─ requirements.txt
  ├─ data\
  │   ├─ amsmst.txt
  │   ├─ nasmst.txt
  │   ├─ nysmst.txt
  │   ├─ watchlist.json          # 스캐너 결과 (자동 생성)
  │   └─ offline_features.parquet# 1년치 피처/라벨 (자동 생성)
  ├─ utils\
  │   ├─ universe.py             # 마스터(txt) → 심볼 리스트
  │   ├─ fmp_api.py              # FMP API 유틸
  │   └─ metrics.py              # ATR/RVOL 등 공통 지표
  ├─ offline\
  │   ├─ scanner.py              # (1) 종목 발굴
  │   ├─ features_offline.py     # (2) 1년치 피처/라벨 생성 (정규장 기준)
  │   └─ train_daily.py          # (3) 전역 모델 + 티커별 통계 학습
  ├─ server\
  │   ├─ server.py               # (4) FastAPI + WebSocket 신호 서버 (정규장만)
  │   └─ feature_live.py         # 실시간 피처 계산 (정규장 RTH + FMP 폴링)
  └─ docs\
      └─ fmp_rth_flow.md         # (바로 이 문서를 저장하면 좋음)
👉 지금 이 MD를 C:\dev\chart-core\docs\fmp_rth_flow.md로 저장해두고,
Cursor에서 위에서부터 차례대로 구현하는 흐름을 추천.

2. 파이썬 환경 & 의존성
2-1. 가상환경 생성 (선택)
bash
코드 복사
cd C:\dev\chart-core
python -m venv .venv
.\.venv\Scripts\activate
2-2. requirements.txt
txt
코드 복사
fastapi==0.115.5
uvicorn[standard]==0.32.0
pandas==2.2.3
numpy==2.1.3
requests==2.32.3
python-dotenv==1.0.1
scikit-learn==1.5.2
lightgbm==4.5.0
설치:

bash
코드 복사
pip install -r requirements.txt
3. FMP API 키 설정 (.env)
루트에 .env 생성:

env
코드 복사
FMP_API_KEY=여기에_FMP_키_입력
TZ_UI=Asia/Seoul
4. 종목 마스터 로더 (universe.py)
utils\universe.py 생성.

전제: 각 txt 파일은 한 줄에 한 종목, 첫 컬럼이 티커라고 가정.
(형식이 다르면 여기에서 파싱만 조정)

python
코드 복사
# utils/universe.py
import os
from typing import List, Set

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(ROOT, "data")

MASTER_FILES = [
    os.path.join(DATA_DIR, "amsmst.txt"),
    os.path.join(DATA_DIR, "nasmst.txt"),
    os.path.join(DATA_DIR, "nysmst.txt"),
]

def _load_one(path: str) -> List[str]:
    syms = []
    if not os.path.exists(path):
        return syms
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            # 기본 가정: 첫 번째 토큰이 심볼
            tok = line.split()[0]
            # 너무 긴 문자열, 이상한 것 간단 필터
            if 1 <= len(tok) <= 6:
                syms.append(tok.upper())
    return syms

def load_universe() -> List[str]:
    """
    AMEX + NASDAQ + NYSE 전체 심볼 리스트
    """
    all_syms: Set[str] = set()
    for p in MASTER_FILES:
        all_syms.update(_load_one(p))
    return sorted(all_syms)

if __name__ == "__main__":
    syms = load_universe()
    print("symbols:", len(syms))
    print(syms[:50])
Cursor에서 이 파일 만든 뒤 python utils/universe.py로 잘 로딩되는지 확인.

5. FMP API 유틸 (fmp_api.py)
utils\fmp_api.py 생성.

python
코드 복사
# utils/fmp_api.py
import os
import requests
from urllib.parse import urlencode
from dotenv import load_dotenv

load_dotenv()

FMP_KEY = os.getenv("FMP_API_KEY")
BASE = "https://financialmodelingprep.com/api"

def _get(path: str, params: dict | None = None):
    if FMP_KEY is None:
        raise RuntimeError("FMP_API_KEY is not set in .env")
    params = params or {}
    params["apikey"] = FMP_KEY
    url = f"{BASE}{path}?{urlencode(params)}"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    return r.json()

def get_profile(symbol: str):
    return _get(f"/v3/profile/{symbol}")

def get_quote(symbol: str):
    return _get(f"/v3/quote/{symbol}")

def get_hist_daily(symbol: str, days: int = 400):
    return _get(f"/v3/historical-price-full/{symbol}", {
        "serietype": "line",
        "timeseries": days
    })

def get_hist_1min(symbol: str, minutes: int = 390*5):
    """
    정규장(RTH) 기준 최근 n분 1분봉.
    FMP는 전체(프리+정규+애프터)일 수 있으나,
    우선은 단순하게 최근 minutes 분을 가져오는 방식으로 사용.
    """
    return _get(f"/v3/historical-chart/1min/{symbol}", {
        "timeseries": minutes
    })
6. 공통 지표 (metrics.py)
utils\metrics.py 생성.

python
코드 복사
# utils/metrics.py
import numpy as np
import pandas as pd

def atr(df: pd.DataFrame, period: int = 5) -> pd.Series:
    """
    df: columns = [o,h,l,c]
    """
    h, l, c = df["o"].values, df["h"].values, df["c"].values
    prev_c = np.r_[c[0], c[:-1]]
    tr = np.maximum.reduce([
        h - l,
        np.abs(h - prev_c),
        np.abs(l - prev_c)
    ])
    return pd.Series(tr).rolling(period).mean()

def intraday_spread_est(df_1m: pd.DataFrame) -> float:
    """
    근사 스프레드: 마지막 1~3분 고저/종가 기반
    """
    if len(df_1m) == 0:
        return 0.0
    sub = df_1m.tail(3)
    hi = sub["high"].max()
    lo = sub["low"].min()
    c = sub["close"].iloc[-1]
    if c == 0:
        return 0.0
    return max(0.0, (hi - lo) / c)

def simple_rvol(vol_series: pd.Series, base_window: int = 390*5, curr_window: int = 1) -> pd.Series:
    """
    간단 RVOL: 현재 N분 거래량 / 과거 평균 N분 거래량
    """
    v = vol_series
    base = v.rolling(base_window, min_periods=base_window//4).mean()
    curr = v.rolling(curr_window, min_periods=curr_window).sum()
    return (curr / (base + 1e-9)).fillna(1.0)
7. 스캐너 (정규장 패턴형 종목 발굴) – offline/scanner.py
7-1. 기본 설정 (config_scanner 느낌을 코드에 내장)
offline\scanner.py 생성.

python
코드 복사
# offline/scanner.py
import os, json
import pandas as pd

from utils.universe import load_universe
from utils.fmp_api import get_profile, get_hist_daily, get_hist_1min
from utils.metrics import atr, simple_rvol, intraday_spread_est

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(ROOT, "data")
os.makedirs(DATA_DIR, exist_ok=True)

# 필터/스코어 기준 (정규장 전용 1차 버전)
CFG = {
    "price_min": 0.3,
    "price_max": 15.0,
    "mcap_min": 20_000_000,
    "mcap_max": 1_500_000_000,
    "min_score": 70,
}

def pattern_score(symbol: str) -> dict | None:
    """
    심볼 1개에 대해 패턴 점수 계산 후 dict 반환.
    스코어 < min_score 이면 None 반환.
    """
    prof = get_profile(symbol)
    if not prof:
        return None
    p0 = prof[0]
    mcap = p0.get("mktCap") or 0
    if not (CFG["mcap_min"] <= mcap <= CFG["mcap_max"]):
        return None

    # 일봉 최근 60일
    daily = get_hist_daily(symbol, days=60)
    if "historical" not in daily or len(daily["historical"]) < 20:
        return None
    d = pd.DataFrame(daily["historical"])[["open","high","low","close","volume"]]
    d.columns = ["o","h","l","c","v"]

    # ATR5 (%)
    atr5 = atr(d, 5).iloc[-1]
    price = d["c"].iloc[-1]
    if price <= 0:
        return None
    atr5_pct = float(atr5 / price)

    # 최근 5일 / 20일 사이 ±20% 종가 변동 횟수
    d20 = d.tail(20).copy()
    d20["pct"] = d20["c"].pct_change()
    big_move_cnt = int((d20["pct"].abs() >= 0.20).sum())

    # 1분봉 기반 RVOL / 스프레드
    m1 = get_hist_1min(symbol, minutes=390*10)   # 약 10일치 정규장 근사
    df1 = pd.DataFrame(m1)[["date","open","high","low","close","volume"]]
    df1.columns = ["ts","open","high","low","close","volume"]
    df1 = df1.dropna().reset_index(drop=True)
    if len(df1) < 200:
        return None

    rvol = simple_rvol(df1["volume"], base_window=390*5, curr_window=1)
    rvol_peak = float(rvol.tail(390).max())   # 최근 하루 내 최대 RVOL
    spread_est = float(intraday_spread_est(df1.rename(columns={
        "open":"o","high":"high","low":"low","close":"close"
    })))

    # 점수 구성 (단순 버전)
    score = 0
    # ATR5 >= 8%
    if atr5_pct >= 0.08:
        score += 30
    elif atr5_pct >= 0.05:
        score += 20

    # 큰 변동 횟수
    if big_move_cnt >= 3:
        score += 25
    elif big_move_cnt >= 1:
        score += 15

    # RVOL 피크
    if rvol_peak >= 3.0:
        score += 25
    elif rvol_peak >= 2.0:
        score += 15

    # 스프레드
    if spread_est <= 0.012:
        score += 20
    elif spread_est <= 0.02:
        score += 10

    if score < CFG["min_score"]:
        return None

    return {
        "symbol": symbol,
        "score": score,
        "price": round(float(price), 3),
        "mcap": int(mcap),
        "atr5_pct": round(atr5_pct*100, 2),
        "big_move_cnt20": big_move_cnt,
        "rvol_peak": round(rvol_peak, 2),
        "spread_est_pct": round(spread_est*100, 2),
    }

def main():
    universe = load_universe()
    print("universe size:", len(universe))

    results = []
    for i, sym in enumerate(universe, start=1):
        try:
            r = pattern_score(sym)
            if r:
                results.append(r)
                print("[KEEP]", r)
        except Exception as e:
            print("[ERR]", sym, e)
        if i % 200 == 0:
            print(f"... processed {i} symbols")

    results = sorted(results, key=lambda x: x["score"], reverse=True)
    out_path = os.path.join(DATA_DIR, "watchlist.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"symbols":[r["symbol"] for r in results],
                   "detail": results}, f, indent=2)
    print(f"saved -> {out_path} (n={len(results)})")

if __name__ == "__main__":
    main()
✅ 여기까지 하면
python offline/scanner.py 실행 시
정규장 패턴형 소형주 watchlist가 자동 생성됩니다.

8. 오프라인 피처/라벨 + 모델 학습 (정규장 버전)
여기서는 간략 버전으로 구현하고,
추후 프리/애프터·Polygon까지 포함한 “완전판”으로 확장할 수 있게 틀만 잡습니다.

8-1. features_offline.py (단일 세션 = RTH 가정)
offline/features_offline.py:

python
코드 복사
# offline/features_offline.py
import os
from pathlib import Path
from typing import List, Dict

import pandas as pd
import numpy as np

from utils.fmp_api import get_hist_1min, get_hist_daily
from utils.metrics import intraday_spread_est, simple_rvol

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

CFG = {
    "lookback_days": 120,      # 1차 버전: 최근 4개월 정도
    "label_windows": [30, 60], # 30/60분 라벨
    "label_up": 0.04,
    "label_down": -0.015,
}

def label_future(df: pd.DataFrame, idx: int) -> Dict[str, float]:
    res = {}
    price0 = float(df.loc[idx, "close"])
    n = len(df)
    for W in CFG["label_windows"]:
        hi = float(df.loc[idx+1 : min(idx+W, n-1), "high"].max()) if idx+1 < n else price0
        lo = float(df.loc[idx+1 : min(idx+W, n-1), "low"].min()) if idx+1 < n else price0
        mfe = (hi - price0) / price0
        mae = (lo - price0) / price0
        lbl = 1 if (mfe >= CFG["label_up"] and mae >= CFG["label_down"]) else 0
        res[f"mfe_{W}m"] = float(mfe)
        res[f"mae_{W}m"] = float(mae)
        res[f"label_{W}m"] = int(lbl)
    return res

def build_one(symbol: str) -> pd.DataFrame:
    # 분봉(최근 lookback_days * 390 분 근사)
    m1 = get_hist_1min(symbol, minutes=390*CFG["lookback_days"])
    if not isinstance(m1, list) or len(m1) < 400:
        return pd.DataFrame()
    df = pd.DataFrame(m1)[["date","open","high","low","close","volume"]]
    df.columns = ["ts","open","high","low","close","volume"]
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.sort_values("ts").reset_index(drop=True)

    # 간단 RVOL: 전체 기간 기준
    rvol = simple_rvol(df["volume"], base_window=390*20, curr_window=1)
    df["rvol_1m"] = rvol

    # 스프레드 근사
    spreads = []
    for i in range(len(df)):
        lo = max(0, i-2)
        sub = df.iloc[lo:i+1][["open","high","low","close"]]
        spreads.append(intraday_spread_est(sub.rename(columns={"open":"o"})))
    df["spread_est"] = spreads

    # 간단 베이스폭: 최근 30분 고저폭
    base_ranges = []
    for i in range(len(df)):
        lo = max(0, i-30)
        sub = df.iloc[lo:i+1]
        hi = sub["high"].max()
        lo_ = sub["low"].min()
        mid = (hi+lo_)/2 if (hi+lo_)!=0 else 1
        base_ranges.append((hi-lo_)/mid if mid!=0 else 0)
    df["base_range"] = base_ranges

    events = []
    for i in range(60, len(df)-max(CFG["label_windows"])-1):
        # 간단 이벤트: rvol>=2 & base_range<=6% & 직전 종가 대비 +3% 이상
        if df.loc[i, "rvol_1m"] < 2.0:
            continue
        if df.loc[i, "base_range"] > 0.06:
            continue
        prev_close = df.loc[i-1, "close"]
        if prev_close <= 0:
            continue
        move = (df.loc[i, "close"] - prev_close) / prev_close
        if move < 0.03:
            continue

        lab = label_future(df, i)
        ev = {
            "symbol": symbol,
            "ts": df.loc[i, "ts"],
            "price": float(df.loc[i, "close"]),
            "rvol_1m": float(df.loc[i, "rvol_1m"]),
            "base_range": float(df.loc[i, "base_range"]),
            "spread_est": float(df.loc[i, "spread_est"]),
            "move_prev": float(move),
        }
        ev.update(lab)
        events.append(ev)

    return pd.DataFrame(events)

def build_and_save(symbols: List[str], out_path: str | None = None) -> str:
    frames = []
    for s in symbols:
        try:
            df = build_one(s)
            if len(df):
                frames.append(df)
                print(f"[OK] {s} events={len(df)}")
            else:
                print(f"[NOEV] {s}")
        except Exception as e:
            print(f"[ERR] {s}", e)

    if not frames:
        out = pd.DataFrame(columns=[
            "symbol","ts","price","rvol_1m","base_range","spread_est","move_prev",
            "mfe_30m","mae_30m","label_30m","mfe_60m","mae_60m","label_60m"
        ])
    else:
        out = pd.concat(frames, ignore_index=True)

    if out_path is None:
        out_path = str(DATA_DIR / "offline_features.parquet")
    out.to_parquet(out_path, index=False)
    print("saved ->", out_path, "rows:", len(out))
    return out_path

if __name__ == "__main__":
    # 일단 watchlist.json 기준으로만 진행
    wl_path = DATA_DIR / "watchlist.json"
    if wl_path.exists():
        obj = json.load(open(wl_path,"r"))
        syms = obj.get("symbols", [])[:50]  # 처음엔 상위 50개만
    else:
        syms = []
    build_and_save(syms)
8-2. train_daily.py (전역 모델 + 티커별 통계)
offline/train_daily.py (간단 버전):

python
코드 복사
# offline/train_daily.py
import os, json, pickle
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score
from lightgbm import LGBMClassifier

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
FEATURES_PATH = DATA_DIR / "offline_features.parquet"
MODEL_PATH = DATA_DIR / "model_lgbm_30m.bin"
SYM_STATS_PATH = DATA_DIR / "symbol_stats.json"

FEATURES = ["rvol_1m","base_range","spread_est","move_prev"]
TARGET = "label_30m"

def compute_sym_stats(df: pd.DataFrame) -> dict:
    out = {}
    for sym, g in df.groupby("symbol"):
        ok = g[g[TARGET]==1]
        if len(ok)==0:
            continue
        out[sym] = {
            "rvol_success_q60": float(ok["rvol_1m"].quantile(0.60)),
            "spread_success_q90": float(ok["spread_est"].quantile(0.90)),
            "score_success_q70": 0.65,  # 초기값, 나중에 점수 분포로 조정
        }
    return out

def main():
    if not FEATURES_PATH.exists():
        print("no offline_features.parquet")
        return
    df = pd.read_parquet(FEATURES_PATH)
    df = df.dropna(subset=[TARGET]+FEATURES).copy()

    X = df[FEATURES].values
    y = df[TARGET].values.astype(int)

    if len(df) < 200:
        print("not enough data, train skipped")
        return

    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, shuffle=True, random_state=42)

    model = LGBMClassifier(
        n_estimators=400,
        learning_rate=0.03,
        num_leaves=31,
        class_weight="balanced",
        random_state=42,
    )
    model.fit(X_tr, y_tr)
    prob = model.predict_proba(X_te)[:,1]
    auc = roc_auc_score(y_te, prob)
    print("valid AUC:", auc)

    # 전체 데이터 기준 점수 저장
    df["score"] = model.predict_proba(df[FEATURES].values)[:,1]
    sym_stats = compute_sym_stats(df)

    DATA_DIR.mkdir(exist_ok=True)
    with open(MODEL_PATH,"wb") as f:
        pickle.dump(model,f)
    with open(SYM_STATS_PATH,"w") as f:
        json.dump(sym_stats,f,indent=2)
    print("saved model:", MODEL_PATH)
    print("saved stats:", SYM_STATS_PATH)

if __name__ == "__main__":
    main()
9. 정규장 실시간 신호 서버 골격 (FastAPI + WS)
정규장 + FMP 폴링만 사용하는 아주 단순 버전입니다.
프리·애프터, Polygon, 세션별 룰은 나중 단계에 붙이면 됩니다.

9-1. server/server.py
python
코드 복사
# server/server.py
import os, json, asyncio, datetime as dt
from pathlib import Path

from fastapi import FastAPI, WebSocket
import uvicorn

from server.feature_live import build_live_features
from utils.fmp_api import get_quote

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

app = FastAPI()
CLIENTS = set()

def load_watchlist():
    p = DATA_DIR / "watchlist.json"
    if not p.exists():
        return []
    obj = json.load(open(p,"r"))
    return obj.get("symbols", [])[:50]  # 처음엔 상위 50개만 감시

@app.websocket("/ws")
async def ws_feed(ws: WebSocket):
    await ws.accept()
    CLIENTS.add(ws)
    try:
        while True:
            await asyncio.sleep(1)
    finally:
        CLIENTS.discard(ws)

async def broadcast(msg: dict):
    dead = []
    for ws in list(CLIENTS):
        try:
            await ws.send_json(msg)
        except Exception:
            dead.append(ws)
    for d in dead:
        CLIENTS.discard(d)

async def monitor_loop():
    while True:
        syms = load_watchlist()
        for sym in syms:
            try:
                df, feats = build_live_features(sym)
                # 아주 단순한 진입 조건 (추후 ML 모델 + 통계 결합으로 교체)
                # 예: rvol >= 2.0 & base_range<=6% & 1분 전 대비 +3% 이상
                if len(df) < 3:
                    continue
                c0 = df["close"].iloc[-1]
                c1 = df["close"].iloc[-2]
                move = (c0 - c1) / c1 if c1>0 else 0
                if feats["rvol"] >= 2.0 and feats["base_range"] <= 0.06 and move >= 0.03:
                    now = dt.datetime.utcnow().isoformat()
                    payload = {
                        "t": now,
                        "session": "RTH",
                        "symbol": sym,
                        "state": "RePump",
                        "price": float(c0),
                        "vwap": float(df["close"].mean()),  # 임시
                        "rvol_1m": float(feats["rvol"]),
                        "base_range_pct": float(feats["base_range"]),
                        "score": None,
                        "thr": None,
                        "rules_used": {
                            "gap_min": 0.08,
                            "rvol_min": 2.0,
                            "spread_max": 0.012,
                            "cooldown_min": 15,
                        },
                    }
                    await broadcast(payload)
            except Exception as e:
                print("monitor err", sym, e)
        await asyncio.sleep(5)

if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.create_task(monitor_loop())
    uvicorn.run(app, host="0.0.0.0", port=8000)
9-2. server/feature_live.py (정규장 FMP 폴링)
python
코드 복사
# server/feature_live.py
import pandas as pd
from utils.fmp_api import get_hist_1min
from utils.metrics import intraday_spread_est

def build_live_features(symbol: str):
    m1 = get_hist_1min(symbol, minutes=180)  # 최근 3시간
    df = pd.DataFrame(m1)[["date","open","high","low","close","volume"]]
    df.columns = ["ts","open","high","low","close","volume"]
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.sort_values("ts").reset_index(drop=True)
    # 간단 base_range: 최근 30분 박스
    if len(df) == 0:
        return df, {"rvol":1.0,"base_range":0.0,"gap":0.0,"spread":0.0}
    sub = df.tail(30)
    hi = sub["high"].max()
    lo = sub["low"].min()
    mid = (hi+lo)/2 if (hi+lo)!=0 else 1
    base_range = (hi-lo)/mid if mid!=0 else 0
    spread = intraday_spread_est(sub.rename(columns={"open":"o"}))
    feats = {
        "rvol": 2.0,   # TODO: 실시간 RVOL 계산 로직으로 교체
        "base_range": base_range,
        "gap": 0.1,    # TODO: 전일종가 기반 갭 계산 추가 가능
        "spread": spread,
    }
    return df, feats
10. 개발/실행 순서 (정리)
Cursor에서 작업할 때 이 순서로 진행하면 됩니다.

기본 셋업

requirements.txt 작성 → pip install -r requirements.txt

.env에 FMP_API_KEY 설정

유틸/기초 구성

utils/universe.py (마스터 txt→심볼)

utils/fmp_api.py (FMP 호출)

utils/metrics.py (ATR/RVOL/스프레드)

스캐너 구현

offline/scanner.py 작성

python offline/scanner.py 실행 → data/watchlist.json 생성

오프라인 피처/라벨

offline/features_offline.py 작성

python offline/features_offline.py 실행 → offline_features.parquet 생성

모델 학습

offline/train_daily.py 작성

python offline/train_daily.py 실행 → model_lgbm_30m.bin, symbol_stats.json 생성
(초기엔 데이터 부족해도 구조만 잡혀 있으면 OK)

실시간 서버

server/feature_live.py 작성

server/server.py 작성

python server/server.py 실행

(임시로 브라우저에서 ws://localhost:8000/ws에 연결하거나, 간단 HTML/Next.js에서 WebSocket 연결해 신호 수신 테스트)

이후 확장

Polygon WebSocket 스트림 → 프리/애프터 커버

세션별 룰(PRE/RTH/POST) 분리

Next.js 대시보드 UI

Docker + 스케줄러 (매일 자동 학습)

이렇게 하면 **“정규장 + FMP만 사용하는 최소 시스템”**이