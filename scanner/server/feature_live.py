# server/feature_live.py
"""
실시간 피처 계산 (정규장 FMP 폴링)
"""
import sys
from pathlib import Path

import pandas as pd

# 상위 디렉토리를 경로에 추가
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils.fmp_api import get_hist_1min
from utils.metrics import intraday_spread_est

def build_live_features(symbol: str):
    """
    실시간 피처 계산
    
    Returns:
        df: 최근 분봉 데이터프레임
        feats: 계산된 피처 dict
    """
    try:
        # 최근 3시간 분봉 데이터
        m1 = get_hist_1min(symbol, minutes=180)
        
        if not m1 or len(m1) == 0:
            return pd.DataFrame(), {
                "rvol": 1.0,
                "base_range": 0.0,
                "gap": 0.0,
                "spread": 0.0
            }
        
        # 데이터프레임 생성
        df = pd.DataFrame(m1)[["date", "open", "high", "low", "close", "volume"]]
        df.columns = ["ts", "open", "high", "low", "close", "volume"]
        df["ts"] = pd.to_datetime(df["ts"], utc=True)
        df = df.sort_values("ts").reset_index(drop=True)
        
        if len(df) == 0:
            return df, {
                "rvol": 1.0,
                "base_range": 0.0,
                "gap": 0.0,
                "spread": 0.0
            }
        
        # 베이스 범위: 최근 30분 박스
        sub = df.tail(30)
        hi = sub["high"].max()
        lo = sub["low"].min()
        mid = (hi + lo) / 2 if (hi + lo) != 0 else 1
        base_range = (hi - lo) / mid if mid != 0 else 0
        
        # 스프레드 추정
        spread = intraday_spread_est(sub.rename(columns={"open": "o"}))
        
        # RVOL 간단 계산 (TODO: 더 정교한 로직으로 교체)
        # 현재는 최근 거래량 / 평균 거래량
        if len(df) >= 60:
            recent_vol = df.tail(10)["volume"].mean()
            base_vol = df["volume"].mean()
            rvol = recent_vol / base_vol if base_vol > 0 else 1.0
        else:
            rvol = 1.0
        
        # 갭 계산 (TODO: 전일 종가 기반으로 개선 가능)
        gap = 0.0
        
        feats = {
            "rvol": float(rvol),
            "base_range": float(base_range),
            "gap": float(gap),
            "spread": float(spread),
        }
        
        return df, feats
    
    except Exception as e:
        print(f"[ERROR] build_live_features({symbol}): {e}")
        return pd.DataFrame(), {
            "rvol": 1.0,
            "base_range": 0.0,
            "gap": 0.0,
            "spread": 0.0
        }

if __name__ == "__main__":
    # 테스트
    print("=== 실시간 피처 테스트 ===\n")
    
    test_symbol = "AAPL"
    df, feats = build_live_features(test_symbol)
    
    print(f"{test_symbol} 데이터:")
    print(f"  - 분봉 개수: {len(df)}")
    print(f"  - RVOL: {feats['rvol']:.2f}")
    print(f"  - 베이스 범위: {feats['base_range']:.4f}")
    print(f"  - 스프레드: {feats['spread']:.4f}")
    
    if len(df) > 0:
        print(f"\n최근 5분:")
        print(df.tail(5)[["ts", "close", "volume"]])

