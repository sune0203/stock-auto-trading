"""
기술적 분석 엔진
VWAP, 거래량, 모멘텀, 호가 스프레드 등 분석
"""

import numpy as np
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
from loguru import logger
from api.fmp_client import FMPAPIClient


class TechnicalAnalyzer:
    """기술적 분석 엔진"""
    
    def __init__(self, fmp_client: Optional[FMPAPIClient] = None):
        self.fmp_client = fmp_client or FMPAPIClient()
        logger.info("기술적 분석 엔진 초기화")
    
    # ========== VWAP 분석 ==========
    
    def calculate_vwap(
        self,
        symbol: str,
        interval: str = "5min"
    ) -> Dict[str, any]:
        """
        VWAP (Volume Weighted Average Price) 계산
        
        Args:
            symbol: 종목 심볼
            interval: 시간 간격 (1min, 5min, 15min)
        
        Returns:
            VWAP 정보 및 점수
        """
        # 오늘 날짜
        today = datetime.now().strftime("%Y-%m-%d")
        
        # 분봉 데이터 조회 (오늘)
        chart_data = self.fmp_client.get_intraday_chart(
            symbol=symbol,
            interval=interval,
            from_date=today
        )
        
        if not chart_data or len(chart_data) == 0:
            logger.warning(f"{symbol}: 차트 데이터 없음")
            return {
                "vwap": 0,
                "current_price": 0,
                "deviation_percent": 0,
                "score": 0,
                "status": "no_data"
            }
        
        # VWAP 계산
        total_pv = 0  # price * volume
        total_volume = 0
        
        for candle in chart_data:
            # 평균 가격 (high + low + close) / 3
            typical_price = (candle.get('high', 0) + candle.get('low', 0) + candle.get('close', 0)) / 3
            volume = candle.get('volume', 0)
            
            total_pv += typical_price * volume
            total_volume += volume
        
        vwap = total_pv / total_volume if total_volume > 0 else 0
        
        # 현재가
        current_price = chart_data[0].get('close', 0) if len(chart_data) > 0 else 0
        
        # VWAP 대비 편차 (%)
        deviation_percent = ((current_price - vwap) / vwap * 100) if vwap > 0 else 0
        
        # 점수 계산 (15점 만점)
        score = self._calculate_vwap_score(deviation_percent)
        
        logger.info(f"{symbol} VWAP: ${vwap:.2f}, 현재가: ${current_price:.2f}, 편차: {deviation_percent:.2f}%, 점수: {score}/15")
        
        return {
            "vwap": round(vwap, 2),
            "current_price": round(current_price, 2),
            "deviation_percent": round(deviation_percent, 2),
            "score": score,
            "status": "above_vwap" if deviation_percent > 0 else "below_vwap"
        }
    
    def _calculate_vwap_score(self, deviation_percent: float) -> float:
        """
        VWAP 편차 기반 점수 계산
        
        Args:
            deviation_percent: VWAP 대비 편차 (%)
        
        Returns:
            점수 (0-15)
        """
        if deviation_percent > 5:
            return 15.0
        elif deviation_percent > 3:
            return 10.0
        elif deviation_percent > 1:
            return 5.0
        else:
            return 0.0
    
    # ========== 거래량 분석 ==========
    
    def calculate_volume_surge(
        self,
        symbol: str
    ) -> Dict[str, any]:
        """
        거래량 폭증 분석 (1분, 5분, 일 누적)
        
        Args:
            symbol: 종목 심볼
        
        Returns:
            거래량 분석 정보 및 점수
        """
        # 현재 시세 (실시간 거래량)
        quote = self.fmp_client.get_quote(symbol)
        current_volume = quote.get('volume', 0)
        
        # 20일 평균 거래량
        avg_volume_20d = quote.get('avgVolume', 0)
        if avg_volume_20d == 0:
            # avgVolume이 없으면 과거 데이터로 계산
            avg_volume_20d = self._calculate_avg_volume(symbol, days=20)
        
        # 일 누적 거래량 배수
        volume_ratio_daily = current_volume / avg_volume_20d if avg_volume_20d > 0 else 0
        
        # 1분봉 거래량 (최근 1분)
        chart_1m = self.fmp_client.get_intraday_chart(symbol, "1min")
        volume_1m = chart_1m[0].get('volume', 0) if len(chart_1m) > 0 else 0
        
        # 5분봉 거래량 (최근 5분)
        chart_5m = self.fmp_client.get_intraday_chart(symbol, "5min")
        volume_5m = chart_5m[0].get('volume', 0) if len(chart_5m) > 0 else 0
        
        # 1분/5분 평균 거래량 추정 (일 평균 거래량 기반)
        # 정규장 390분 기준
        avg_volume_1m = avg_volume_20d / 390 if avg_volume_20d > 0 else 0
        avg_volume_5m = avg_volume_20d / 78 if avg_volume_20d > 0 else 0
        
        # 거래량 배수
        volume_ratio_1m = volume_1m / avg_volume_1m if avg_volume_1m > 0 else 0
        volume_ratio_5m = volume_5m / avg_volume_5m if avg_volume_5m > 0 else 0
        
        # 점수 계산 (25점 만점)
        score = self._calculate_volume_score(volume_ratio_1m, volume_ratio_5m, volume_ratio_daily)
        
        logger.info(f"{symbol} 거래량: 1분={volume_ratio_1m:.1f}배, 5분={volume_ratio_5m:.1f}배, 일={volume_ratio_daily:.1f}배, 점수={score}/25")
        
        return {
            "volume_1m": volume_1m,
            "volume_5m": volume_5m,
            "volume_daily": current_volume,
            "avg_volume_20d": avg_volume_20d,
            "volume_ratio_1m": round(volume_ratio_1m, 2),
            "volume_ratio_5m": round(volume_ratio_5m, 2),
            "volume_ratio_daily": round(volume_ratio_daily, 2),
            "score": score
        }
    
    def _calculate_volume_score(self, ratio_1m: float, ratio_5m: float, ratio_daily: float) -> float:
        """
        거래량 배수 기반 점수 계산
        
        Args:
            ratio_1m: 1분 거래량 배수
            ratio_5m: 5분 거래량 배수
            ratio_daily: 일 거래량 배수
        
        Returns:
            점수 (0-25)
        """
        # 1분 거래량 점수 (10점)
        if ratio_1m > 10:
            score_1m = 10.0
        elif ratio_1m > 5:
            score_1m = 7.0
        elif ratio_1m > 3:
            score_1m = 4.0
        else:
            score_1m = 0.0
        
        # 5분 거래량 점수 (10점)
        if ratio_5m > 8:
            score_5m = 10.0
        elif ratio_5m > 4:
            score_5m = 7.0
        elif ratio_5m > 2:
            score_5m = 4.0
        else:
            score_5m = 0.0
        
        # 일 누적 거래량 점수 (5점)
        if ratio_daily > 2:
            score_daily = 5.0
        elif ratio_daily > 1.5:
            score_daily = 3.0
        else:
            score_daily = 0.0
        
        return score_1m + score_5m + score_daily
    
    def _calculate_avg_volume(self, symbol: str, days: int = 20) -> float:
        """
        과거 데이터로 평균 거래량 계산
        
        Args:
            symbol: 종목 심볼
            days: 기간 (일)
        
        Returns:
            평균 거래량
        """
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=days+5)).strftime("%Y-%m-%d")
        
        chart = self.fmp_client.get_daily_chart(symbol, from_date=start_date, to_date=end_date)
        
        if not chart or len(chart) == 0:
            return 0
        
        volumes = [candle.get('volume', 0) for candle in chart]
        return np.mean(volumes) if len(volumes) > 0 else 0
    
    # ========== 단기 모멘텀 ==========
    
    def calculate_momentum(
        self,
        symbol: str
    ) -> Dict[str, any]:
        """
        단기 모멘텀 분석 (5분, 15분)
        
        Args:
            symbol: 종목 심볼
        
        Returns:
            모멘텀 정보 및 점수
        """
        # 5분봉 데이터
        chart_5m = self.fmp_client.get_intraday_chart(symbol, "5min")
        
        if not chart_5m or len(chart_5m) < 2:
            logger.warning(f"{symbol}: 모멘텀 계산 데이터 부족")
            return {
                "momentum_5m": 0,
                "momentum_15m": 0,
                "score": 0
            }
        
        # 5분 모멘텀 (최근 가격 vs 5분 전)
        price_now = chart_5m[0].get('close', 0)
        price_5m_ago = chart_5m[1].get('close', 0) if len(chart_5m) > 1 else 0
        
        momentum_5m = ((price_now - price_5m_ago) / price_5m_ago * 100) if price_5m_ago > 0 else 0
        
        # 15분 모멘텀 (15분봉 데이터)
        chart_15m = self.fmp_client.get_intraday_chart(symbol, "15min")
        
        if len(chart_15m) >= 2:
            price_15m_ago = chart_15m[1].get('close', 0)
            momentum_15m = ((price_now - price_15m_ago) / price_15m_ago * 100) if price_15m_ago > 0 else 0
        else:
            momentum_15m = 0
        
        # 점수 계산 (15점 만점)
        score = self._calculate_momentum_score(momentum_5m, momentum_15m)
        
        logger.info(f"{symbol} 모멘텀: 5분={momentum_5m:.2f}%, 15분={momentum_15m:.2f}%, 점수={score}/15")
        
        return {
            "momentum_5m": round(momentum_5m, 2),
            "momentum_15m": round(momentum_15m, 2),
            "score": score
        }
    
    def _calculate_momentum_score(self, momentum_5m: float, momentum_15m: float) -> float:
        """
        모멘텀 기반 점수 계산
        
        Args:
            momentum_5m: 5분 모멘텀 (%)
            momentum_15m: 15분 모멘텀 (%)
        
        Returns:
            점수 (0-15)
        """
        # 5분 모멘텀 점수 (10점)
        if momentum_5m > 10:
            score_5m = 10.0
        elif momentum_5m > 5:
            score_5m = 7.0
        elif momentum_5m > 3:
            score_5m = 4.0
        else:
            score_5m = 0.0
        
        # 15분 모멘텀 점수 (5점)
        if momentum_15m > 15:
            score_15m = 5.0
        elif momentum_15m > 10:
            score_15m = 3.0
        else:
            score_15m = 0.0
        
        return score_5m + score_15m
    
    # ========== 호가 스프레드 ==========
    
    def calculate_spread(
        self,
        symbol: str,
        use_aftermarket: bool = False
    ) -> Dict[str, any]:
        """
        호가 스프레드 분석
        
        Args:
            symbol: 종목 심볼
            use_aftermarket: 시간외 API 사용 여부
        
        Returns:
            스프레드 정보 및 점수
        """
        if use_aftermarket:
            quote = self.fmp_client.get_aftermarket_quote(symbol)
        else:
            # 정규장에는 일반 quote API 사용 (bid/ask 포함)
            quote = self.fmp_client.get_quote(symbol)
        
        if not quote:
            logger.warning(f"{symbol}: 호가 데이터 없음")
            return {
                "bid_price": 0,
                "ask_price": 0,
                "spread": 0,
                "spread_percent": 0,
                "score": 0
            }
        
        # FMP의 일반 quote에는 bid/ask가 없을 수 있음
        # 시간외 quote만 제공
        if use_aftermarket:
            bid_price = quote.get('bidPrice', 0)
            ask_price = quote.get('askPrice', 0)
        else:
            # 정규장에는 스프레드 계산 제한적
            # 대안: 실제로는 Level 2 데이터 필요
            bid_price = 0
            ask_price = 0
        
        spread = ask_price - bid_price if ask_price and bid_price else 0
        spread_percent = (spread / ask_price * 100) if ask_price > 0 else 0
        
        # 점수 계산 (5점 만점)
        score = self._calculate_spread_score(spread_percent)
        
        logger.info(f"{symbol} 스프레드: {spread_percent:.3f}%, 점수={score}/5")
        
        return {
            "bid_price": bid_price,
            "ask_price": ask_price,
            "spread": round(spread, 3),
            "spread_percent": round(spread_percent, 3),
            "score": score
        }
    
    def _calculate_spread_score(self, spread_percent: float) -> float:
        """
        스프레드 기반 점수 계산 (좁을수록 높음)
        
        Args:
            spread_percent: 스프레드 비율 (%)
        
        Returns:
            점수 (0-5)
        """
        if spread_percent < 0.1:
            return 5.0
        elif spread_percent < 0.3:
            return 3.0
        elif spread_percent < 0.5:
            return 1.0
        else:
            return 0.0


if __name__ == "__main__":
    """테스트 코드"""
    from loguru import logger
    
    # 로깅 설정
    logger.add("logs/technical_test.log", rotation="1 day")
    
    # 분석기 생성
    analyzer = TechnicalAnalyzer()
    
    test_symbol = "AAPL"
    
    # VWAP 분석
    print(f"\n=== {test_symbol} VWAP 분석 ===")
    vwap_info = analyzer.calculate_vwap(test_symbol)
    print(f"VWAP: ${vwap_info['vwap']}")
    print(f"현재가: ${vwap_info['current_price']}")
    print(f"편차: {vwap_info['deviation_percent']}%")
    print(f"점수: {vwap_info['score']}/15")
    
    # 거래량 분석
    print(f"\n=== {test_symbol} 거래량 분석 ===")
    volume_info = analyzer.calculate_volume_surge(test_symbol)
    print(f"1분 배수: {volume_info['volume_ratio_1m']}배")
    print(f"5분 배수: {volume_info['volume_ratio_5m']}배")
    print(f"일 배수: {volume_info['volume_ratio_daily']}배")
    print(f"점수: {volume_info['score']}/25")
    
    # 모멘텀 분석
    print(f"\n=== {test_symbol} 모멘텀 분석 ===")
    momentum_info = analyzer.calculate_momentum(test_symbol)
    print(f"5분 모멘텀: {momentum_info['momentum_5m']}%")
    print(f"15분 모멘텀: {momentum_info['momentum_15m']}%")
    print(f"점수: {momentum_info['score']}/15")
    
    # 스프레드 분석
    print(f"\n=== {test_symbol} 스프레드 분석 ===")
    use_aftermarket = analyzer.fmp_client.should_use_aftermarket_api()
    spread_info = analyzer.calculate_spread(test_symbol, use_aftermarket=use_aftermarket)
    print(f"스프레드: {spread_info['spread_percent']}%")
    print(f"점수: {spread_info['score']}/5")

