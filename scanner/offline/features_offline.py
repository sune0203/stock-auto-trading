# offline/features_offline.py
"""
오프라인 피처/라벨 생성 (정규장 버전)
1년치 데이터를 기반으로 피처와 라벨을 생성하여 parquet 파일로 저장
"""
import os
import json
import sys
from pathlib import Path
from typing import List, Dict

import pandas as pd
import numpy as np

# 상위 디렉토리를 경로에 추가
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils.fmp_api import get_hist_15min, get_hist_daily  # 15분봉으로 전환
from utils.metrics import intraday_spread_est, simple_rvol

DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

CFG = {
    "lookback_days": 40,        # 15분봉 44일치 활용 (약 1144개 봉)
    "label_windows": [2, 4],    # 15분봉 2개(30분), 4개(60분) 후 결과
    "label_up": 0.03,           # 상승 목표: +3%
    "label_down": -0.02,        # 하락 허용: -2%
    "timeframe": "15min",       # 타임프레임 명시
}

def label_future(df: pd.DataFrame, idx: int) -> Dict[str, float]:
    """
    미래 라벨 계산 (MFE/MAE 기반)
    15분봉 기준: W개 봉 = W * 15분
    """
    res = {}
    price0 = float(df.loc[idx, "close"])
    n = len(df)
    
    for W in CFG["label_windows"]:
        # 미래 W개 봉 동안의 최고가/최저가
        if idx + 1 >= n:
            hi = price0
            lo = price0
        else:
            end_idx = min(idx + W, n - 1)
            hi = float(df.loc[idx+1:end_idx, "high"].max())
            lo = float(df.loc[idx+1:end_idx, "low"].min())
        
        # MFE (Maximum Favorable Excursion): 최대 이익
        mfe = (hi - price0) / price0 if price0 > 0 else 0
        
        # MAE (Maximum Adverse Excursion): 최대 손실
        mae = (lo - price0) / price0 if price0 > 0 else 0
        
        # 라벨: MFE >= label_up AND MAE >= label_down
        lbl = 1 if (mfe >= CFG["label_up"] and mae >= CFG["label_down"]) else 0
        
        # 라벨 이름: W개 봉 * 15분
        minutes = W * 15
        res[f"mfe_{minutes}m"] = float(mfe)
        res[f"mae_{minutes}m"] = float(mae)
        res[f"label_{minutes}m"] = int(lbl)
    
    return res

def build_one(symbol: str, verbose: bool = False) -> pd.DataFrame:
    """
    단일 심볼에 대해 피처/라벨 생성
    """
    if verbose:
        print(f"\n{'='*70}")
        print(f"🔍 [{symbol}] 피처 생성 시작")
    
    # 1. 15분봉 데이터 가져오기 (1일 = 26개 봉)
    target_bars = 26 * CFG["lookback_days"]
    if verbose:
        print(f"  📊 15분봉 데이터 조회 중... (목표: {target_bars}개 = {CFG['lookback_days']}일)")
    
    m1 = get_hist_15min(symbol, bars=target_bars)
    if not isinstance(m1, list) or len(m1) < 100:  # 최소 100개 봉 (약 4일치)
        if verbose:
            data_len = len(m1) if m1 else 0
            print(f"  ❌ 데이터 부족: {data_len}개 (필요: 100개 이상)")
        return pd.DataFrame()
    
    if verbose:
        print(f"  ✅ 15분봉 데이터 조회 완료: {len(m1)}개")
    
    df = pd.DataFrame(m1)[["date", "open", "high", "low", "close", "volume"]]
    df.columns = ["ts", "open", "high", "low", "close", "volume"]
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.sort_values("ts").reset_index(drop=True)

    # 2. RVOL 계산 (15분봉 기준)
    # 5일 = 26개 * 5 = 130개 봉을 베이스로
    base_window = min(130, len(df) // 2)  # 최소 절반을 베이스로
    if verbose:
        print(f"  🔄 RVOL 계산 중... (베이스: {base_window}개 봉, 전체: {len(df)}개)")
    rvol = simple_rvol(df["volume"], base_window=base_window, curr_window=1)
    df["rvol_15m"] = rvol
    if verbose:
        print(f"  ✅ RVOL 계산 완료 (평균: {rvol.mean():.2f}, 최대: {rvol.max():.2f})")

    # 3. 스프레드 근사 (각 시점별)
    if verbose:
        print(f"  🔄 스프레드 계산 중... ({len(df)}개 시점)")
    spreads = []
    for i in range(len(df)):
        lo = max(0, i-2)
        sub = df.iloc[lo:i+1][["open", "high", "low", "close"]]
        spreads.append(intraday_spread_est(sub.rename(columns={"open": "o"})))
    df["spread_est"] = spreads
    if verbose:
        print(f"  ✅ 스프레드 계산 완료 (평균: {sum(spreads)/len(spreads):.4f})")

    # 4. 베이스 범위: 최근 2개 봉 (30분) 고저폭 (%)
    if verbose:
        print(f"  🔄 베이스 범위 계산 중...")
    base_ranges = []
    for i in range(len(df)):
        lo = max(0, i-2)  # 2개 15분봉 = 30분
        sub = df.iloc[lo:i+1]
        hi = sub["high"].max()
        lo_ = sub["low"].min()
        mid = (hi + lo_) / 2 if (hi + lo_) != 0 else 1
        base_ranges.append((hi - lo_) / mid if mid != 0 else 0)
    df["base_range"] = base_ranges
    if verbose:
        print(f"  ✅ 베이스 범위 계산 완료")

    # 5. 이벤트 발굴 (15분봉 40일 데이터 기준)
    if verbose:
        print(f"  🔄 이벤트 발굴 중...")
        print(f"     조건: RVOL>=1.5, 베이스범위<=8%, 직전대비>=+2%")
    
    events = []
    filtered_stats = {"rvol": 0, "base_range": 0, "move": 0, "passed": 0}
    
    # 시작 인덱스: 20개 봉 이후부터 (워밍업)
    for i in range(20, len(df) - max(CFG["label_windows"]) - 1):
        # RVOL 조건
        if df.loc[i, "rvol_15m"] < 1.5:
            filtered_stats["rvol"] += 1
            continue
        
        # 베이스 범위 조건
        if df.loc[i, "base_range"] > 0.08:
            filtered_stats["base_range"] += 1
            continue
        
        # 이전 종가 대비 상승 조건
        prev_close = df.loc[i-1, "close"]
        if prev_close <= 0:
            continue
        
        move = (df.loc[i, "close"] - prev_close) / prev_close
        if move < 0.02:
            filtered_stats["move"] += 1
            continue

        # 라벨 계산
        lab = label_future(df, i)
        
        ev = {
            "symbol": symbol,
            "ts": df.loc[i, "ts"],
            "price": float(df.loc[i, "close"]),
            "rvol_15m": float(df.loc[i, "rvol_15m"]),
            "base_range": float(df.loc[i, "base_range"]),
            "spread_est": float(df.loc[i, "spread_est"]),
            "move_prev": float(move),
        }
        ev.update(lab)
        events.append(ev)
        filtered_stats["passed"] += 1

    if verbose:
        total_checked = len(df) - 20 - max(CFG["label_windows"]) - 1
        print(f"  ✅ 이벤트 발굴 완료: {len(events)}개 발견 (검사: {total_checked}개)")
        if total_checked > 0:
            print(f"     필터링: RVOL={filtered_stats['rvol']}, 범위={filtered_stats['base_range']}, 변동={filtered_stats['move']}")

    return pd.DataFrame(events)

def build_and_save(symbols: List[str], out_path: str | None = None, verbose: bool = False) -> str:
    """
    여러 심볼에 대해 피처/라벨 생성 후 저장
    """
    print("=" * 70)
    print("🚀 피처 생성 시작")
    print("=" * 70)
    print(f"처리할 종목: {len(symbols)}개")
    print(f"설정:")
    print(f"  - 조회 기간: {CFG['lookback_days']}일")
    print(f"  - 라벨 윈도우: {CFG['label_windows']}분")
    print(f"  - 상승 목표: +{CFG['label_up']*100}%")
    print(f"  - 하락 허용: {CFG['label_down']*100}%")
    print("\n")
    
    frames = []
    stats = {
        "total": len(symbols),
        "success": 0,
        "no_events": 0,
        "errors": 0,
        "total_events": 0
    }
    
    for idx, s in enumerate(symbols, 1):
        try:
            print(f"\n[{idx}/{len(symbols)}] {s:6s} 처리 중...")
            df = build_one(s, verbose=verbose)
            if len(df):
                frames.append(df)
                stats["success"] += 1
                stats["total_events"] += len(df)
                print(f"  ✅ 완료: {len(df)}개 이벤트 발견")
            else:
                stats["no_events"] += 1
                print(f"  ⚠️ 이벤트 없음")
        except Exception as e:
            stats["errors"] += 1
            print(f"  ❌ 에러: {e}")
        
        # 진행 상황 출력 (10개마다)
        if idx % 10 == 0:
            print(f"\n{'='*70}")
            print(f"진행률: {idx}/{len(symbols)} ({idx/len(symbols)*100:.1f}%)")
            print(f"성공: {stats['success']}, 이벤트 없음: {stats['no_events']}, 에러: {stats['errors']}")
            print(f"총 이벤트: {stats['total_events']}개")
            print(f"{'='*70}\n")

    # 결과 통합
    print("\n" + "=" * 70)
    print("📊 결과 통합 중...")
    
    if not frames:
        print("⚠️ 이벤트가 하나도 발견되지 않았습니다.")
        out = pd.DataFrame(columns=[
            "symbol", "ts", "price", "rvol_1m", "base_range", "spread_est", "move_prev",
            "mfe_30m", "mae_30m", "label_30m", "mfe_60m", "mae_60m", "label_60m"
        ])
    else:
        out = pd.concat(frames, ignore_index=True)
        print(f"✅ {len(frames)}개 종목에서 총 {len(out)}개 이벤트 통합 완료")

    # 저장
    if out_path is None:
        out_path = str(DATA_DIR / "offline_features.parquet")
    
    print(f"\n💾 파일 저장 중: {out_path}")
    out.to_parquet(out_path, index=False)
    print(f"✅ 저장 완료!")
    
    # 최종 리포트
    print("\n" + "=" * 70)
    print("🎯 피처 생성 완료!")
    print("=" * 70)
    print(f"저장 경로: {out_path}")
    print(f"\n📊 최종 통계:")
    print(f"  처리 종목: {stats['total']}개")
    print(f"  성공: {stats['success']}개 ({stats['success']/stats['total']*100:.1f}%)")
    print(f"  이벤트 없음: {stats['no_events']}개")
    print(f"  에러: {stats['errors']}개")
    print(f"  총 이벤트: {stats['total_events']}개")
    
    if len(out) > 0:
        print(f"\n📈 라벨 분포:")
        label_30m_count = int(out['label_30m'].sum())
        label_60m_count = int(out['label_60m'].sum())
        print(f"  30분 성공: {label_30m_count:4d} / {len(out):4d} = {out['label_30m'].mean():.2%}")
        print(f"  60분 성공: {label_60m_count:4d} / {len(out):4d} = {out['label_60m'].mean():.2%}")
        
        print(f"\n📊 피처 요약:")
        print(f"  RVOL 평균: {out['rvol_15m'].mean():.2f} (최대: {out['rvol_15m'].max():.2f})")
        print(f"  베이스범위 평균: {out['base_range'].mean():.4f}")
        print(f"  스프레드 평균: {out['spread_est'].mean():.4f}")
        print(f"  직전변동 평균: {out['move_prev'].mean():.4f}")
    
    print("=" * 70)
    
    return out_path

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="피처/라벨 생성")
    parser.add_argument("--verbose", "-v", action="store_true", help="상세 로그 출력")
    parser.add_argument("--limit", type=int, default=None, help="처리할 종목 수 제한 (기본: 전체)")
    
    args = parser.parse_args()
    
    # watchlist.json에서 심볼 로드
    wl_path = DATA_DIR / "watchlist.json"
    
    print("=" * 70)
    print("📂 Watchlist 로드")
    print("=" * 70)
    
    if wl_path.exists():
        print(f"경로: {wl_path}")
        obj = json.load(open(wl_path, "r"))
        syms = obj.get("symbols", [])
        
        if args.limit:
            syms = syms[:args.limit]
            print(f"✅ {len(syms)}개 종목 로드됨 (제한: {args.limit}개)")
        else:
            print(f"✅ {len(syms)}개 종목 로드됨 (전체)")
        
        print(f"상위 10개: {', '.join(syms[:10])}")
    else:
        print(f"❌ watchlist.json 파일이 없습니다: {wl_path}")
        print("💡 scanner.py를 먼저 실행하세요.")
        syms = []
    
    if syms:
        build_and_save(syms, verbose=args.verbose)
    else:
        print("\n처리할 종목이 없습니다.")

