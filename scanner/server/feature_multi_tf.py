# server/feature_multi_tf.py
"""
멀티 타임프레임 실시간 피처 계산
1분봉 + 5분봉 + 15분봉 + 현재가 통합 분석
"""
import sys
from pathlib import Path
from typing import Dict, Tuple, Optional

import pandas as pd

# 상위 디렉토리를 경로에 추가
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils.fmp_api import get_quote, get_hist_1min, get_hist_5min, get_hist_15min
from utils.metrics import intraday_spread_est, simple_rvol

def analyze_timeframe(df: pd.DataFrame, timeframe: str, current_price: float = None) -> Dict:
    """
    단일 타임프레임 분석
    
    Args:
        df: 분봉 데이터프레임
        timeframe: '1min', '5min', '15min'
        current_price: 현재가 (옵션)
    
    Returns:
        피처 딕셔너리
    """
    if len(df) < 10:
        return {
            "rvol": 1.0,
            "base_range": 0.0,
            "spread": 0.0,
            "move_pct": 0.0,
            "valid": False
        }
    
    # 베이스 윈도우 크기 (타임프레임별 조정)
    if timeframe == "1min":
        base_window = min(60, len(df) // 2)  # 1시간
        base_bars = 30  # 베이스 범위: 30분
    elif timeframe == "5min":
        base_window = min(78, len(df) // 2)  # 5일치 (78개 * 5분)
        base_bars = 6  # 베이스 범위: 30분 (6개 * 5분)
    else:  # 15min
        base_window = min(130, len(df) // 2)  # 5일치
        base_bars = 2  # 베이스 범위: 30분 (2개 * 15분)
    
    # RVOL 계산
    rvol = simple_rvol(df["volume"], base_window=base_window, curr_window=1)
    current_rvol = float(rvol.iloc[-1]) if len(rvol) > 0 else 1.0
    
    # 베이스 범위: 최근 N개 봉
    sub = df.tail(base_bars)
    hi = sub["high"].max()
    lo = sub["low"].min()
    mid = (hi + lo) / 2 if (hi + lo) != 0 else 1
    base_range = (hi - lo) / mid if mid != 0 else 0
    
    # 스프레드 추정
    spread = intraday_spread_est(sub.rename(columns={"open": "o"}))
    
    # 직전 봉 대비 변화율
    if len(df) >= 2:
        prev_close = df.iloc[-2]["close"]
        current_close = df.iloc[-1]["close"]
        move_pct = (current_close - prev_close) / prev_close if prev_close > 0 else 0
    else:
        move_pct = 0.0
    
    # 현재가가 제공된 경우, 최신 봉 대비 변화 계산
    if current_price is not None:
        latest_close = df.iloc[-1]["close"]
        realtime_move = (current_price - latest_close) / latest_close if latest_close > 0 else 0
    else:
        realtime_move = 0.0
    
    return {
        "rvol": float(current_rvol),
        "base_range": float(base_range),
        "spread": float(spread),
        "move_pct": float(move_pct),
        "realtime_move": float(realtime_move),
        "price": float(df.iloc[-1]["close"]),
        "valid": True
    }

def build_multi_tf_features(symbol: str) -> Tuple[Dict, Optional[float]]:
    """
    멀티 타임프레임 실시간 피처 계산
    
    Returns:
        (features_dict, current_price)
        
    features_dict 구조:
    {
        "symbol": "AAPL",
        "current_price": 150.50,
        "1min": {...},
        "5min": {...},
        "15min": {...},
        "signal": {
            "1min": True/False,
            "5min": True/False,
            "15min": True/False
        }
    }
    """
    result = {
        "symbol": symbol,
        "current_price": None,
        "1min": None,
        "5min": None,
        "15min": None,
        "signal": {
            "1min": False,
            "5min": False,
            "15min": False
        }
    }
    
    try:
        # 1. 현재가 조회
        quote = get_quote(symbol)
        if not quote or len(quote) == 0:
            return result, None
        
        current_price = quote[0].get("price", 0)
        result["current_price"] = current_price
        
        # 2. 1분봉 분석
        data_1min = get_hist_1min(symbol, minutes=100)
        if data_1min and len(data_1min) >= 10:
            df_1min = pd.DataFrame(data_1min)[["date", "open", "high", "low", "close", "volume"]]
            df_1min.columns = ["ts", "open", "high", "low", "close", "volume"]
            df_1min["ts"] = pd.to_datetime(df_1min["ts"], utc=True)
            df_1min = df_1min.sort_values("ts").reset_index(drop=True)
            
            result["1min"] = analyze_timeframe(df_1min, "1min", current_price)
        
        # 3. 5분봉 분석
        data_5min = get_hist_5min(symbol, bars=100)
        if data_5min and len(data_5min) >= 10:
            df_5min = pd.DataFrame(data_5min)[["date", "open", "high", "low", "close", "volume"]]
            df_5min.columns = ["ts", "open", "high", "low", "close", "volume"]
            df_5min["ts"] = pd.to_datetime(df_5min["ts"], utc=True)
            df_5min = df_5min.sort_values("ts").reset_index(drop=True)
            
            result["5min"] = analyze_timeframe(df_5min, "5min", current_price)
        
        # 4. 15분봉 분석
        data_15min = get_hist_15min(symbol, bars=100)
        if data_15min and len(data_15min) >= 10:
            df_15min = pd.DataFrame(data_15min)[["date", "open", "high", "low", "close", "volume"]]
            df_15min.columns = ["ts", "open", "high", "low", "close", "volume"]
            df_15min["ts"] = pd.to_datetime(df_15min["ts"], utc=True)
            df_15min = df_15min.sort_values("ts").reset_index(drop=True)
            
            result["15min"] = analyze_timeframe(df_15min, "15min", current_price)
        
        # 5. 신호 판단 (각 타임프레임별)
        for tf in ["1min", "5min", "15min"]:
            if result[tf] and result[tf]["valid"]:
                # 조건: RVOL >= 1.5, 베이스 범위 <= 8%, 변동 >= +2%
                signal = (
                    result[tf]["rvol"] >= 1.5 and
                    result[tf]["base_range"] <= 0.08 and
                    (result[tf]["move_pct"] >= 0.02 or result[tf]["realtime_move"] >= 0.02)
                )
                result["signal"][tf] = signal
        
        return result, current_price
    
    except Exception as e:
        print(f"[ERROR] build_multi_tf_features({symbol}): {e}")
        return result, None

if __name__ == "__main__":
    # 테스트
    print("=== 멀티 타임프레임 피처 테스트 ===\n")
    
    test_symbol = "AAPL"
    features, current_price = build_multi_tf_features(test_symbol)
    
    print(f"{test_symbol} 분석:")
    print(f"  현재가: ${current_price:.2f}" if current_price else "  현재가: N/A")
    
    for tf in ["1min", "5min", "15min"]:
        print(f"\n[{tf}]")
        if features[tf] and features[tf]["valid"]:
            print(f"  RVOL: {features[tf]['rvol']:.2f}")
            print(f"  베이스 범위: {features[tf]['base_range']:.2%}")
            print(f"  변동: {features[tf]['move_pct']:.2%}")
            print(f"  실시간 변동: {features[tf]['realtime_move']:.2%}")
            print(f"  신호: {'✅' if features['signal'][tf] else '❌'}")
        else:
            print(f"  데이터 없음")

