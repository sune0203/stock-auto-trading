# server/signal_engine.py
"""
멀티 타임프레임 신호 엔진 (ML 모델 통합)
1분/5분/15분봉 + 현재가 → ML 예측 → 신호 발생
"""
import sys
from pathlib import Path
from typing import Dict, Optional, Tuple

import pandas as pd
import numpy as np
from xgboost import XGBClassifier

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils.fmp_api import get_quote, get_hist_1min, get_hist_5min, get_hist_15min
from utils.metrics import simple_rvol, intraday_spread_est
from server.data_cache import HIST_CACHE

class SignalEngine:
    """
    멀티 타임프레임 신호 엔진
    """
    
    def __init__(self, model: XGBClassifier, symbol_stats: dict):
        """
        Args:
            model: 학습된 LightGBM 모델
            symbol_stats: 심볼별 통계 (임계값 등)
        """
        self.model = model
        self.symbol_stats = symbol_stats
        
        # 피처 순서 (학습 시와 동일해야 함)
        self.FEATURES = ["rvol", "base_range", "spread_est", "move_prev"]
    
    def calculate_features(self, df: pd.DataFrame, timeframe: str, current_price: float = None) -> Optional[Dict]:
        """
        단일 타임프레임 피처 계산
        
        Args:
            df: 분봉 데이터프레임
            timeframe: '1min', '5min', '15min'
            current_price: 현재가 (옵션)
        
        Returns:
            피처 딕셔너리 or None
        """
        if len(df) < 20:
            return None
        
        # 타임프레임별 윈도우 설정
        if timeframe == "1min":
            base_window = min(60, len(df) // 2)  # 1시간
            base_bars = 30  # 30분
        elif timeframe == "5min":
            base_window = min(78, len(df) // 2)  # 약 6.5시간
            base_bars = 6  # 30분
        else:  # 15min
            base_window = min(130, len(df) // 2)  # 약 16시간
            base_bars = 2  # 30분
        
        # 1. RVOL 계산
        rvol_series = simple_rvol(df["volume"], base_window=base_window, curr_window=1)
        rvol = float(rvol_series.iloc[-1]) if len(rvol_series) > 0 else 1.0
        
        # 2. 베이스 범위 (최근 N개 봉)
        i = len(df) - 1
        lo_idx = max(0, i - base_bars)
        sub = df.iloc[lo_idx:i+1]
        hi = sub["high"].max()
        lo = sub["low"].min()
        mid = (hi + lo) / 2 if (hi + lo) != 0 else 1
        base_range = (hi - lo) / mid if mid != 0 else 0
        
        # 3. 스프레드 추정
        spread_est = intraday_spread_est(sub.rename(columns={"open": "o"}))
        
        # 4. 직전 봉 대비 변화
        if len(df) >= 2:
            prev_close = df.iloc[-2]["close"]
            curr_close = df.iloc[-1]["close"]
            move_prev = (curr_close - prev_close) / prev_close if prev_close > 0 else 0
        else:
            move_prev = 0.0
        
        # 5. 현재가 기준 실시간 변화
        if current_price is not None and len(df) > 0:
            latest_close = df.iloc[-1]["close"]
            realtime_move = (current_price - latest_close) / latest_close if latest_close > 0 else 0
        else:
            realtime_move = 0.0
        
        return {
            "rvol": float(rvol),
            "base_range": float(base_range),
            "spread_est": float(spread_est),
            "move_prev": float(move_prev),
            "realtime_move": float(realtime_move),
            "price": float(df.iloc[-1]["close"]),
            "valid": True
        }
    
    def analyze_symbol_rth(self, symbol: str) -> Dict:
        """
        정규장(RTH) 분석: 1/5/15분봉 + 현재가 활용
        
        Returns:
            분석 결과 딕셔너리
        """
        result = {
            "symbol": symbol,
            "session": "RTH",
            "current_price": None,
            "signals": {}
        }
        
        try:
            # 1. 현재가 조회
            quote = get_quote(symbol)
            if not quote or len(quote) == 0:
                return result
            
            current_price = quote[0].get("price", 0)
            result["current_price"] = current_price
            
            # 2. 각 타임프레임별 분석
            timeframes = {
                "1min": (get_hist_1min, 120),  # 최근 2시간
                "5min": (get_hist_5min, 24),   # 최근 2시간
                "15min": (get_hist_15min, 8)   # 최근 2시간
            }
            
            for tf_name, (fetch_func, bars) in timeframes.items():
                try:
                    # 15분봉은 캐싱 사용 (변화가 느림)
                    if tf_name == "15min":
                        data = HIST_CACHE.get(symbol)
                        if data is None:
                            data = fetch_func(symbol, bars=bars)
                            if data and len(data) >= 10:
                                HIST_CACHE.set(symbol, data)
                    else:
                        # 1분/5분봉은 실시간 조회
                        data = fetch_func(symbol, bars=bars)
                    
                    if not data or len(data) < 10:
                        continue
                    
                    df = pd.DataFrame(data)[["date", "open", "high", "low", "close", "volume"]]
                    df.columns = ["ts", "open", "high", "low", "close", "volume"]
                    df["ts"] = pd.to_datetime(df["ts"], utc=True)
                    df = df.sort_values("ts").reset_index(drop=True)
                    
                    # 피처 계산
                    feats = self.calculate_features(df, tf_name, current_price)
                    if not feats or not feats["valid"]:
                        continue
                    
                    # 기본 필터
                    if feats["rvol"] < 1.5 or feats["base_range"] > 0.08:
                        continue
                    
                    # ML 모델 예측
                    X = [[
                        feats["rvol"],
                        feats["base_range"],
                        feats["spread_est"],
                        feats["move_prev"]
                    ]]
                    
                    # XGBoost: 양성 클래스(1) 확률 반환
                    prob = self.model.predict_proba(X)[0][1]
                    
                    # 심볼별 임계값
                    threshold = self.symbol_stats.get(symbol, {}).get("threshold", 0.5)
                    
                    # 신호 판단
                    signal = prob >= threshold
                    
                    result["signals"][tf_name] = {
                        "features": feats,
                        "ml_score": float(prob),
                        "threshold": float(threshold),
                        "signal": signal
                    }
                
                except Exception as e:
                    print(f"[ERROR] {symbol} {tf_name} 분석 실패: {e}")
                    continue
            
            return result
        
        except Exception as e:
            print(f"[ERROR] {symbol} RTH 분석 실패: {e}")
            return result
    
    def analyze_symbol_pre_after(self, symbol: str, current_price: float, session: str = "PRE_AFTER") -> Dict:
        """
        프리/애프터마켓 분석: 현재가 + 이전 정규장 데이터 활용
        
        Args:
            symbol: 종목 심볼
            current_price: 현재가 (batch-aftermarket-trade에서 가져온 값)
            session: "PRE" or "AFTER"
        
        Returns:
            분석 결과 딕셔너리
        """
        result = {
            "symbol": symbol,
            "session": session,
            "current_price": current_price,
            "signals": {}
        }
        
        try:
            # 현재가 검증
            if not current_price or current_price <= 0:
                return result
            
            # 2. 이전 정규장 데이터로 피처 계산 (15분봉 사용)
            # 캐시 확인
            data = HIST_CACHE.get(symbol)
            if data is None:
                # 캐시 미스: API 호출
                data = get_hist_15min(symbol, bars=50)
                if data and len(data) >= 20:
                    HIST_CACHE.set(symbol, data)
            
            if not data or len(data) < 20:
                return result
            
            df = pd.DataFrame(data)[["date", "open", "high", "low", "close", "volume"]]
            df.columns = ["ts", "open", "high", "low", "close", "volume"]
            df["ts"] = pd.to_datetime(df["ts"], utc=True)
            df = df.sort_values("ts").reset_index(drop=True)
            
            # 피처 계산 (현재가 반영)
            feats = self.calculate_features(df, "15min", current_price)
            if not feats or not feats["valid"]:
                print(f"  [DEBUG] {symbol}: 피처 계산 실패")
                return result
            
            # 기본 필터
            if feats["rvol"] < 1.5:
                print(f"  [DEBUG] {symbol}: RVOL 부족 ({feats['rvol']:.2f} < 1.5)")
                return result
            
            if feats["base_range"] > 0.08:
                print(f"  [DEBUG] {symbol}: base_range 초과 ({feats['base_range']*100:.2f}% > 8%)")
                return result
            
            # ML 모델 예측
            X = [[
                feats["rvol"],
                feats["base_range"],
                feats["spread_est"],
                feats["move_prev"]
            ]]
            
            # XGBoost: 양성 클래스(1) 확률 반환
            prob = self.model.predict_proba(X)[0][1]
            threshold = self.symbol_stats.get(symbol, {}).get("threshold", 0.5)
            signal = prob >= threshold
            
            # 디버그: 신호 발생 여부
            if not signal:
                print(f"  [DEBUG] {symbol}: ML 임계값 미달 ({prob:.3f} < {threshold:.3f}) | " +
                      f"RVOL: {feats['rvol']:.2f}, BR: {feats['base_range']*100:.2f}%")
            
            result["signals"]["pre_after"] = {
                "features": feats,
                "ml_score": float(prob),
                "threshold": float(threshold),
                "signal": signal
            }
            
            return result
        
        except Exception as e:
            print(f"[ERROR] {symbol} {session} 분석 실패: {e}")
            return result

if __name__ == "__main__":
    # 테스트
    import json
    from pathlib import Path
    
    DATA_DIR = Path(__file__).resolve().parents[1] / "data"
    MODEL_PATH = DATA_DIR / "model_xgb_30m.json"
    STATS_PATH = DATA_DIR / "symbol_stats.json"
    
    if MODEL_PATH.exists() and STATS_PATH.exists():
        model = XGBClassifier()
        model.load_model(str(MODEL_PATH))
        stats = json.load(open(STATS_PATH, "r"))
        
        engine = SignalEngine(model, stats)
        
        print("=== 신호 엔진 테스트 ===\n")
        
        test_symbol = "AAPL"
        result = engine.analyze_symbol_rth(test_symbol)
        
        print(f"{test_symbol} 분석:")
        print(f"  현재가: ${result['current_price']:.2f}" if result['current_price'] else "  현재가: N/A")
        
        for tf, data in result["signals"].items():
            if data["signal"]:
                print(f"\n  [{tf}] 신호 발생!")
                print(f"    ML 확률: {data['ml_score']:.3f}")
                print(f"    임계값: {data['threshold']:.3f}")
                print(f"    RVOL: {data['features']['rvol']:.2f}")
    else:
        print("모델 또는 통계 파일이 없습니다.")

