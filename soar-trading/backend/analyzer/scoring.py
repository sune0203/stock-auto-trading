"""
종합 스코어링 시스템
모든 팩터를 종합하여 최종 점수 산출
"""

from typing import Optional, Dict
from loguru import logger
from analyzer.technical import TechnicalAnalyzer
from analyzer.news_analyzer import NewsAnalyzer
from api.fmp_client import FMPAPIClient


class ScoreEngine:
    """종합 스코어링 엔진"""
    
    def __init__(
        self,
        technical_analyzer: Optional[TechnicalAnalyzer] = None,
        news_analyzer: Optional[NewsAnalyzer] = None,
        fmp_client: Optional[FMPAPIClient] = None
    ):
        self.technical = technical_analyzer or TechnicalAnalyzer()
        self.news = news_analyzer or NewsAnalyzer()
        self.fmp = fmp_client or FMPAPIClient()
        
        # 점수 구간별 예상 수익률 (P5, P25, P50, P75, P95)
        self.score_brackets = {
            (90, 100): {"p5": 3, "p25": 5, "p50": 8, "p75": 15, "p95": 30},
            (80, 90): {"p5": 2, "p25": 4, "p50": 6, "p75": 10, "p95": 20},
            (70, 80): {"p5": 1, "p25": 3, "p50": 5, "p75": 8, "p95": 15},
            (60, 70): {"p5": 0.5, "p25": 2, "p50": 3, "p75": 6, "p95": 10},
            (0, 60): {"p5": 0, "p25": 1, "p50": 2, "p75": 4, "p95": 8}
        }
        
        logger.info("종합 스코어링 엔진 초기화")
    
    def calculate_score(
        self,
        symbol: str,
        news_hours: int = 24
    ) -> Dict[str, any]:
        """
        종목의 종합 점수 계산 (0-100)
        
        Args:
            symbol: 종목 심볼
            news_hours: 뉴스 조회 시간 범위
        
        Returns:
            종합 점수 및 상세 분석 정보
        """
        logger.info(f"\n{'='*60}")
        logger.info(f"{symbol} 종합 분석 시작")
        logger.info(f"{'='*60}")
        
        # 1. 기술적 분석 (60점)
        vwap_info = self.technical.calculate_vwap(symbol)
        volume_info = self.technical.calculate_volume_surge(symbol)
        momentum_info = self.technical.calculate_momentum(symbol)
        
        # 스프레드 분석 (시장 시간 고려)
        use_aftermarket = self.fmp.should_use_aftermarket_api()
        spread_info = self.technical.calculate_spread(symbol, use_aftermarket=use_aftermarket)
        
        technical_score = (
            vwap_info["score"] +       # 15점
            volume_info["score"] +     # 25점
            momentum_info["score"] +   # 15점
            spread_info["score"]       # 5점
        )
        
        # 2. 뉴스 분석 (25점)
        news_info = self.news.calculate_news_score(symbol, hours=news_hours)
        news_score = news_info["score"]
        
        # 3. 펀더멘털 분석 (15점)
        fundamental_score = self._calculate_fundamental_score(symbol)
        
        # 4. 종합 점수 (100점 만점)
        total_score = technical_score + news_score + fundamental_score
        
        # 5. 예상 수익률
        expected_returns = self._get_expected_returns(total_score)
        
        # 6. 거래 적합성 판단
        is_tradable, reasons = self._check_tradability(symbol, total_score, volume_info)
        
        # 7. 실전 트레이딩 정보 계산
        trading_plan = self._calculate_trading_plan(symbol, total_score, vwap_info, volume_info, momentum_info)
        
        result = {
            "symbol": symbol,
            "total_score": round(total_score, 2),
            "scores": {
                "technical": round(technical_score, 2),
                "news": round(news_score, 2),
                "fundamental": round(fundamental_score, 2)
            },
            "details": {
                "vwap": vwap_info,
                "volume": volume_info,
                "momentum": momentum_info,
                "spread": spread_info,
                "news": news_info,
                "fundamental": {
                    "score": fundamental_score,
                    "float_shares": None,  # 나중에 구현
                    "short_interest": None  # 나중에 구현
                }
            },
            "expected_returns": expected_returns,
            "is_tradable": is_tradable,
            "tradability_reasons": reasons,
            "trading_plan": trading_plan  # 실전 트레이딩 정보 추가
        }
        
        logger.info(f"\n{'='*60}")
        logger.info(f"{symbol} 종합 결과")
        logger.info(f"{'='*60}")
        logger.info(f"총점: {total_score:.2f}/100")
        logger.info(f"  - 기술적 분석: {technical_score:.2f}/60")
        logger.info(f"  - 뉴스 분석: {news_score:.2f}/25")
        logger.info(f"  - 펀더멘털: {fundamental_score:.2f}/15")
        logger.info(f"거래 적합성: {is_tradable}")
        logger.info(f"예상 수익률 (P50): {expected_returns['p50']}%")
        logger.info(f"{'='*60}\n")
        
        return result
    
    def _calculate_fundamental_score(self, symbol: str) -> float:
        """
        펀더멘털 점수 계산 (15점 만점)
        
        Args:
            symbol: 종목 심볼
        
        Returns:
            펀더멘털 점수
        """
        # 유동주식수 점수 (10점)
        try:
            float_shares = self.fmp.get_float_shares(symbol)
            
            if float_shares:
                if float_shares < 10_000_000:  # 1천만주 미만
                    float_score = 10.0
                elif float_shares < 50_000_000:  # 5천만주 미만
                    float_score = 7.0
                elif float_shares < 100_000_000:  # 1억주 미만
                    float_score = 4.0
                else:
                    float_score = 0.0
            else:
                float_score = 0.0
        except Exception as e:
            logger.warning(f"{symbol} 유동주식수 조회 실패: {e}")
            float_score = 0.0
        
        # 공매도 비율 점수 (5점)
        # FMP에서 제공 안 하므로 일단 0점
        short_score = 0.0
        
        total = float_score + short_score
        
        logger.info(f"펀더멘털 점수: {total}/15 (Float: {float_score}/10, Short: {short_score}/5)")
        
        return total
    
    def _get_expected_returns(self, score: float) -> Dict[str, float]:
        """
        점수 구간별 예상 수익률 조회
        
        Args:
            score: 종합 점수
        
        Returns:
            예상 수익률 (P5, P25, P50, P75, P95)
        """
        for (min_score, max_score), returns in self.score_brackets.items():
            if min_score <= score <= max_score:
                return returns
        
        # 기본값 (최하위)
        return self.score_brackets[(0, 60)]
    
    def _check_tradability(
        self,
        symbol: str,
        score: float,
        volume_info: Dict
    ) -> tuple[bool, list[str]]:
        """
        거래 적합성 판단
        
        Args:
            symbol: 종목 심볼
            score: 종합 점수
            volume_info: 거래량 정보
        
        Returns:
            (is_tradable, reasons): 거래 가능 여부 및 사유
        """
        from config import config
        
        reasons = []
        
        # 1. 최소 점수 체크
        if score < config.trading.min_score:
            reasons.append(f"점수 부족 ({score:.1f} < {config.trading.min_score})")
        
        # 2. 최소 거래량 체크
        if volume_info["volume_daily"] < config.trading.min_daily_volume:
            reasons.append(f"거래량 부족 ({volume_info['volume_daily']:,} < {config.trading.min_daily_volume:,})")
        
        # 3. 최소 거래대금 체크
        quote = self.fmp.get_quote(symbol)
        current_price = quote.get('price', 0)
        dollar_volume = current_price * volume_info["volume_daily"]
        
        if dollar_volume < config.trading.min_dollar_volume:
            reasons.append(f"거래대금 부족 (${dollar_volume:,.0f} < ${config.trading.min_dollar_volume:,})")
        
        # 4. 시장 개장 여부
        if not self.fmp.is_market_open():
            reasons.append("시간외 거래 (유동성 낮음)")
        
        is_tradable = len(reasons) == 0
        
        return is_tradable, reasons
    
    def _calculate_trading_plan(
        self,
        symbol: str,
        score: float,
        vwap_info: Dict,
        volume_info: Dict,
        momentum_info: Dict
    ) -> Dict:
        """
        실전 트레이딩 계획 수립
        
        Args:
            symbol: 종목 심볼
            score: 종합 점수
            vwap_info: VWAP 정보
            volume_info: 거래량 정보
            momentum_info: 모멘텀 정보
        
        Returns:
            실전 트레이딩 정보
        """
        # 현재가 조회
        quote = self.fmp.get_quote(symbol)
        current_price = quote.get('price', 0)
        vwap_price = vwap_info.get('vwap', current_price)
        
        # 1. 트레이딩 신호 결정
        signal, signal_strength = self._determine_signal(score, vwap_info, volume_info, momentum_info)
        
        # 2. 진입가 추천
        entry_price = self._calculate_entry_price(current_price, vwap_price, signal)
        
        # 3. 익절가 계산 (3단계)
        targets = self._calculate_target_prices(entry_price, score, momentum_info)
        
        # 4. 손절가 계산
        stop_loss = self._calculate_stop_loss(entry_price, vwap_price, score)
        
        # 5. 리스크/리워드 비율
        risk_reward_ratio = (targets['target1'] - entry_price) / (entry_price - stop_loss) if entry_price > stop_loss else 0
        
        # 6. 포지션 사이즈 추천 (계좌의 %)
        position_size_pct = self._recommend_position_size(score, signal_strength, risk_reward_ratio)
        
        # 7. 보유 기간 추천
        holding_period = self._recommend_holding_period(score, momentum_info)
        
        # 8. 리스크 레벨
        risk_level = self._assess_risk_level(score, volume_info, momentum_info)
        
        # 9. 주요 레벨 (지지/저항)
        key_levels = self._identify_key_levels(current_price, vwap_price, targets, stop_loss)
        
        trading_plan = {
            "signal": signal,  # "BUY", "SELL", "HOLD"
            "signal_strength": signal_strength,  # 1-5
            "current_price": round(current_price, 2),
            "entry_price": round(entry_price, 2),
            "targets": {
                "target1": round(targets['target1'], 2),
                "target1_pct": round(targets['target1_pct'], 1),
                "target2": round(targets['target2'], 2),
                "target2_pct": round(targets['target2_pct'], 1),
                "target3": round(targets['target3'], 2),
                "target3_pct": round(targets['target3_pct'], 1)
            },
            "stop_loss": round(stop_loss, 2),
            "stop_loss_pct": round((entry_price - stop_loss) / entry_price * 100, 1),
            "risk_reward_ratio": round(risk_reward_ratio, 2),
            "position_size_pct": position_size_pct,  # 계좌의 %
            "holding_period": holding_period,  # "intraday", "swing", "position"
            "risk_level": risk_level,  # "low", "medium", "high"
            "key_levels": key_levels,
            "action_summary": self._generate_action_summary(signal, signal_strength, entry_price, targets, stop_loss, risk_level)
        }
        
        return trading_plan
    
    def _determine_signal(self, score, vwap_info, volume_info, momentum_info):
        """트레이딩 신호 결정"""
        # 강한 매수 신호 (70점 이상)
        if score >= 70:
            if momentum_info['momentum_5m'] > 5 and volume_info['surge_1m'] > 10:
                return "BUY", 5  # 매우 강함
            elif momentum_info['momentum_5m'] > 3:
                return "BUY", 4  # 강함
            else:
                return "BUY", 3  # 보통
        
        # 중간 매수 신호 (50-70점)
        elif score >= 50:
            if vwap_info['vwap_deviation'] > 3 and momentum_info['momentum_5m'] > 0:
                return "BUY", 3  # 보통
            else:
                return "HOLD", 2  # 약함
        
        # 약한 매수 또는 대기 (30-50점)
        elif score >= 30:
            if momentum_info['momentum_5m'] > 5:
                return "BUY", 2  # 약한 매수
            else:
                return "HOLD", 1  # 대기
        
        # 매도 또는 무거래 (30점 미만)
        else:
            if momentum_info['momentum_5m'] < -5:
                return "SELL", 2  # 약한 매도
            else:
                return "HOLD", 1  # 대기
    
    def _calculate_entry_price(self, current_price, vwap_price, signal):
        """진입가 계산"""
        if signal == "BUY":
            # VWAP 근처나 현재가 중 낮은 가격
            return min(current_price, vwap_price * 1.01)
        else:
            return current_price
    
    def _calculate_target_prices(self, entry_price, score, momentum_info):
        """익절가 3단계 계산"""
        # 기본 목표 수익률 (점수 기반)
        if score >= 80:
            base_target = 15  # 15%
        elif score >= 70:
            base_target = 10  # 10%
        elif score >= 60:
            base_target = 7   # 7%
        else:
            base_target = 5   # 5%
        
        # 모멘텀 보너스
        momentum_bonus = min(momentum_info['momentum_5m'] * 0.5, 5)  # 최대 +5%
        
        target1_pct = base_target * 0.5 + momentum_bonus  # 1차: 50% + 보너스
        target2_pct = base_target + momentum_bonus         # 2차: 100% + 보너스
        target3_pct = base_target * 1.5 + momentum_bonus  # 3차: 150% + 보너스
        
        return {
            "target1": entry_price * (1 + target1_pct / 100),
            "target1_pct": target1_pct,
            "target2": entry_price * (1 + target2_pct / 100),
            "target2_pct": target2_pct,
            "target3": entry_price * (1 + target3_pct / 100),
            "target3_pct": target3_pct
        }
    
    def _calculate_stop_loss(self, entry_price, vwap_price, score):
        """손절가 계산"""
        # 고점수 종목은 좁은 손절
        if score >= 70:
            stop_loss_pct = 2.0  # -2%
        elif score >= 50:
            stop_loss_pct = 3.0  # -3%
        else:
            stop_loss_pct = 5.0  # -5%
        
        # VWAP 기반 손절가와 비교
        vwap_stop = vwap_price * 0.98  # VWAP -2%
        pct_stop = entry_price * (1 - stop_loss_pct / 100)
        
        # 더 가까운 손절가 사용 (타이트한 관리)
        return max(vwap_stop, pct_stop)
    
    def _recommend_position_size(self, score, signal_strength, risk_reward_ratio):
        """포지션 사이즈 추천 (계좌의 %)"""
        # 기본 포지션
        if score >= 80 and signal_strength >= 4:
            base_size = 15  # 15%
        elif score >= 70:
            base_size = 10  # 10%
        elif score >= 60:
            base_size = 7   # 7%
        else:
            base_size = 5   # 5%
        
        # 리스크/리워드 조정
        if risk_reward_ratio >= 3:
            base_size = min(base_size * 1.2, 20)  # 최대 20%
        elif risk_reward_ratio < 2:
            base_size = base_size * 0.8  # 80%로 감소
        
        return round(base_size, 1)
    
    def _recommend_holding_period(self, score, momentum_info):
        """보유 기간 추천"""
        # 강한 모멘텀 = 단기 트레이딩
        if momentum_info['momentum_5m'] > 10 and momentum_info['momentum_15m'] > 15:
            return "intraday"  # 당일 매매
        elif score >= 70:
            return "swing"  # 2-5일
        else:
            return "position"  # 1-2주
    
    def _assess_risk_level(self, score, volume_info, momentum_info):
        """리스크 레벨 평가"""
        risk_score = 0
        
        # 낮은 점수 = 높은 리스크
        if score < 50:
            risk_score += 2
        elif score < 70:
            risk_score += 1
        
        # 낮은 거래량 = 높은 리스크
        if volume_info['volume_daily'] < 500_000:
            risk_score += 2
        elif volume_info['volume_daily'] < 1_000_000:
            risk_score += 1
        
        # 극단적 모멘텀 = 높은 리스크
        if abs(momentum_info['momentum_5m']) > 20:
            risk_score += 1
        
        if risk_score <= 1:
            return "low"
        elif risk_score <= 3:
            return "medium"
        else:
            return "high"
    
    def _identify_key_levels(self, current_price, vwap_price, targets, stop_loss):
        """주요 가격 레벨 식별"""
        return {
            "resistance_1": targets['target1'],
            "resistance_2": targets['target2'],
            "support_1": vwap_price,
            "support_2": stop_loss
        }
    
    def _generate_action_summary(self, signal, signal_strength, entry_price, targets, stop_loss, risk_level):
        """실행 가능한 액션 요약"""
        if signal == "BUY":
            strength_text = ["매우 약함", "약함", "보통", "강함", "매우 강함"][signal_strength - 1]
            return (
                f"💰 {strength_text} 매수 신호! "
                f"진입: ${entry_price:.2f}, "
                f"1차 익절: ${targets['target1']:.2f} (+{targets['target1_pct']:.1f}%), "
                f"손절: ${stop_loss:.2f} | "
                f"⚠️ 리스크: {risk_level.upper()}"
            )
        elif signal == "SELL":
            return f"⚠️ 매도 신호 - 보유 중이라면 청산 고려"
        else:
            return f"⏸️ 대기 - 명확한 신호 없음"
    
    def calculate_targets(
        self,
        symbol: str,
        entry_price: float,
        score: float
    ) -> Dict[str, float]:
        """
        익절/손절 목표가 계산
        
        Args:
            symbol: 종목 심볼
            entry_price: 진입 가격
            score: 종합 점수
        
        Returns:
            목표가 정보
        """
        from config import config
        
        # 예상 수익률
        returns = self._get_expected_returns(score)
        
        # 익절: P75 수익률 (보수적)
        take_profit_percent = returns["p75"]
        take_profit_price = entry_price * (1 + take_profit_percent / 100)
        
        # 트레일링 스톱: 최대 수익의 70% 방어
        trailing_stop_percent = take_profit_percent * config.trading.trailing_stop_percent
        
        # 손절: 고정 -2%
        stop_loss_percent = config.trading.fixed_stop_loss_percent
        stop_loss_price = entry_price * (1 - stop_loss_percent / 100)
        
        logger.info(f"{symbol} 목표가 설정:")
        logger.info(f"  진입: ${entry_price:.2f}")
        logger.info(f"  익절: ${take_profit_price:.2f} (+{take_profit_percent}%)")
        logger.info(f"  손절: ${stop_loss_price:.2f} (-{stop_loss_percent}%)")
        logger.info(f"  트레일링: {trailing_stop_percent:.1f}%")
        
        return {
            "entry_price": entry_price,
            "take_profit_price": round(take_profit_price, 2),
            "take_profit_percent": take_profit_percent,
            "stop_loss_price": round(stop_loss_price, 2),
            "stop_loss_percent": stop_loss_percent,
            "trailing_stop_percent": round(trailing_stop_percent, 2)
        }


if __name__ == "__main__":
    """테스트 코드"""
    from loguru import logger
    
    # 로깅 설정
    logger.add("logs/scoring_test.log", rotation="1 day")
    
    # 스코어 엔진 생성
    engine = ScoreEngine()
    
    # 테스트 종목들
    test_symbols = ["AAPL", "NVDA", "TSLA"]
    
    for symbol in test_symbols:
        print(f"\n{'='*60}")
        print(f"{symbol} 분석")
        print(f"{'='*60}")
        
        # 종합 점수 계산
        result = engine.calculate_score(symbol)
        
        print(f"\n총점: {result['total_score']}/100")
        print(f"  기술적: {result['scores']['technical']}/60")
        print(f"  뉴스: {result['scores']['news']}/25")
        print(f"  펀더멘털: {result['scores']['fundamental']}/15")
        
        print(f"\n거래 적합성: {result['is_tradable']}")
        if not result['is_tradable']:
            print(f"사유: {', '.join(result['tradability_reasons'])}")
        
        print(f"\n예상 수익률:")
        returns = result['expected_returns']
        print(f"  P5:  {returns['p5']}%")
        print(f"  P50: {returns['p50']}%")
        print(f"  P95: {returns['p95']}%")
        
        # 목표가 계산
        if result['is_tradable']:
            quote = engine.fmp.get_quote(symbol)
            current_price = quote.get('price', 0)
            
            targets = engine.calculate_targets(symbol, current_price, result['total_score'])
            print(f"\n목표가:")
            print(f"  익절: ${targets['take_profit_price']} (+{targets['take_profit_percent']}%)")
            print(f"  손절: ${targets['stop_loss_price']} (-{targets['stop_loss_percent']}%)")

