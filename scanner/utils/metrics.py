# utils/metrics.py
"""
기술적 지표 계산 (ATR, RVOL, 스프레드 등)
"""
import numpy as np
import pandas as pd

def atr(df: pd.DataFrame, period: int = 5) -> pd.Series:
    """
    Average True Range 계산
    df: columns = [o, h, l, c]
    """
    if len(df) < period:
        return pd.Series([0.0] * len(df), index=df.index)
    
    h = df["h"].values
    l = df["l"].values
    c = df["c"].values
    
    # 이전 종가
    prev_c = np.r_[c[0], c[:-1]]
    
    # True Range 계산
    tr = np.maximum.reduce([
        h - l,
        np.abs(h - prev_c),
        np.abs(l - prev_c)
    ])
    
    # ATR: TR의 이동평균
    return pd.Series(tr).rolling(period).mean()

def intraday_spread_est(df_1m: pd.DataFrame) -> float:
    """
    근사 스프레드 계산: 마지막 1~3분 고저 기반
    """
    if len(df_1m) == 0:
        return 0.0
    
    # 최근 3분 데이터
    sub = df_1m.tail(3)
    hi = sub["high"].max()
    lo = sub["low"].min()
    c = sub["close"].iloc[-1]
    
    if c == 0:
        return 0.0
    
    spread = (hi - lo) / c
    return max(0.0, spread)

def simple_rvol(vol_series: pd.Series, base_window: int = 390*5, curr_window: int = 1) -> pd.Series:
    """
    간단 RVOL (Relative Volume) 계산
    현재 N분 거래량 / 과거 평균 N분 거래량
    
    base_window: 기준 평균 계산 윈도우 (기본 5일치 정규장 = 390*5분)
    curr_window: 현재 거래량 계산 윈도우 (기본 1분)
    """
    v = vol_series
    
    # 기준 평균 거래량
    base = v.rolling(base_window, min_periods=base_window//4).mean()
    
    # 현재 거래량
    curr = v.rolling(curr_window, min_periods=curr_window).sum()
    
    # RVOL 계산 (0으로 나누기 방지)
    rvol = (curr / (base + 1e-9)).fillna(1.0)
    
    return rvol

if __name__ == "__main__":
    # 테스트
    print("=== Metrics 테스트 ===")
    
    # 샘플 데이터 생성
    test_df = pd.DataFrame({
        'o': [100, 101, 102, 103, 104],
        'h': [105, 106, 107, 108, 109],
        'l': [99, 100, 101, 102, 103],
        'c': [103, 104, 105, 106, 107],
    })
    
    # ATR 계산
    atr_values = atr(test_df, period=3)
    print(f"\nATR(3): {atr_values.values}")
    
    # 스프레드 계산
    spread_df = pd.DataFrame({
        'open': [100, 101, 102],
        'high': [105, 106, 107],
        'low': [99, 100, 101],
        'close': [103, 104, 105],
    })
    spread = intraday_spread_est(spread_df)
    print(f"스프레드: {spread:.4f}")
    
    # RVOL 계산
    vol_data = pd.Series([1000, 1100, 1200, 1300, 1400, 2000, 2500])
    rvol = simple_rvol(vol_data, base_window=3, curr_window=1)
    print(f"RVOL: {rvol.values}")
    
    print("\n테스트 완료")

