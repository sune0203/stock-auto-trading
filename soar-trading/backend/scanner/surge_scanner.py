"""
급등주 스캐너
KIS API로 급등주를 탐지하고 FMP API로 추가 검증
"""

import time
from datetime import datetime
from typing import List, Dict, Any, Optional, Callable
from loguru import logger
from concurrent.futures import ThreadPoolExecutor, as_completed
from api.kis_client import KISAPIClient
from api.fmp_client import FMPAPIClient
from analyzer.scoring import ScoreEngine
from config import config


def get_market_session() -> str:
    """
    현재 시장 세션 확인 (한국 시간 기준)
    
    Returns:
        "RTH": 정규장 (Regular Trading Hours)
        "PRE": 프리마켓
        "AFTER": 애프터마켓
        "CLOSED": 장마감
    """
    now_kst = datetime.now()
    
    # 서머타임: 2025년 3월 10일 ~ 11월 2일
    dst_start = datetime(2025, 3, 10)
    dst_end = datetime(2025, 11, 2, 23, 59, 59)
    is_dst = dst_start <= now_kst <= dst_end
    
    hour = now_kst.hour
    minute = now_kst.minute
    weekday = now_kst.weekday()  # 0=월요일, 6=일요일
    
    # 주말 체크 (토요일, 일요일)
    if weekday >= 5:
        return "CLOSED"
    
    if is_dst:
        # 서머타임 적용 시 (3월 10일 ~ 11월 2일)
        # 미국 시간 -> 한국 시간 (시차 13시간)
        # 정규장: 09:30 ~ 16:00 (미국) -> 22:30 ~ 05:00 (한국, 익일)
        # 애프터마켓: 16:00 ~ 20:00 (미국) -> 05:00 ~ 09:00 (한국, 익일)
        # 프리마켓: 04:00 ~ 09:30 (미국, 익일) -> 17:00 ~ 22:30 (한국)
        if (hour == 22 and minute >= 30) or (23 <= hour) or (hour < 5):
            return "RTH"
        elif 5 <= hour < 9:
            return "AFTER"
        elif 17 <= hour < 22 or (hour == 22 and minute < 30):
            return "PRE"
        else:
            return "CLOSED"
    else:
        # 서머타임 해제 시 (11월 3일부터)
        # 미국 시간 -> 한국 시간 (시차 14시간)
        # 정규장: 09:30 ~ 16:00 (미국) -> 23:30 ~ 06:00 (한국, 익일)
        # 애프터마켓: 16:00 ~ 20:00 (미국) -> 06:00 ~ 10:00 (한국, 익일)
        # 프리마켓: 04:00 ~ 09:30 (미국, 익일) -> 18:00 ~ 23:30 (한국)
        if (hour == 23 and minute >= 30) or (hour < 6):
            return "RTH"
        elif 6 <= hour < 10:
            return "AFTER"
        elif 18 <= hour < 23 or (hour == 23 and minute < 30):
            return "PRE"
        else:
            return "CLOSED"


def get_session_info() -> Dict[str, Any]:
    """시장 세션 정보 반환"""
    session = get_market_session()
    session_names = {
        "RTH": "정규장",
        "PRE": "프리마켓",
        "AFTER": "애프터마켓",
        "CLOSED": "장마감"
    }
    
    now_kst = datetime.now()
    dst_start = datetime(2025, 3, 10)
    dst_end = datetime(2025, 11, 2, 23, 59, 59)
    is_dst = dst_start <= now_kst <= dst_end
    
    # 다음 장 시작 시간 계산
    next_open_msg = ""
    if session == "CLOSED":
        if is_dst:
            next_open_msg = "다음 프리마켓 시작: 오후 5시"
        else:
            next_open_msg = "다음 프리마켓 시작: 오후 6시"
    
    return {
        "session": session,
        "session_name": session_names.get(session, "알 수 없음"),
        "is_trading": session in ["PRE", "RTH", "AFTER"],
        "is_dst": is_dst,
        "current_time": now_kst.strftime("%Y-%m-%d %H:%M:%S"),
        "next_open": next_open_msg
    }


class SurgeScanner:
    """급등주 스캐너"""
    
    def __init__(
        self,
        kis_client: Optional[KISAPIClient] = None,
        fmp_client: Optional[FMPAPIClient] = None,
        score_engine: Optional[ScoreEngine] = None
    ):
        self.kis = kis_client or KISAPIClient()
        self.fmp = fmp_client or FMPAPIClient()
        self.score_engine = score_engine or ScoreEngine()
        
        self.is_running = False
        self.scan_results: List[Dict] = []
        
        logger.info("급등주 스캐너 초기화")
    
    def scan_once(
        self,
        exchange: str = "NAS",
        direction: str = "1",  # 급등
        timeframe: str = "3",  # 5분전 대비
        volume_filter: str = "3",  # 1만주 이상
        max_symbols: int = 100
    ) -> List[Dict[str, Any]]:
        """
        1회 스캔 실행
        
        Args:
            exchange: 거래소 (NAS, NYS, AMS)
            direction: 0=급락, 1=급등
            timeframe: 시간프레임 (0:1분, 3:5분, 4:10분)
            volume_filter: 거래량 필터 (3:1만주+)
            max_symbols: 최대 조회 종목 수
        
        Returns:
            스캔 결과 리스트
        """
        logger.info(f"\n{'='*60}")
        logger.info(f"급등주 스캔 시작 ({exchange})")
        logger.info(f"{'='*60}")
        
        try:
            # 1. KIS API로 급등주 리스트 조회
            surge_list = self.kis.get_price_surge(
                exchange=exchange,
                direction=direction,
                timeframe=timeframe,
                volume_filter=volume_filter
            )
            
            if not surge_list:
                logger.warning("급등주가 발견되지 않았습니다.")
                return []
            
            logger.info(f"급등주 {len(surge_list)}개 발견")
            
            # 2. 상위 N개만 선택
            top_symbols = surge_list[:max_symbols]
            
            # 3. 각 종목 분석
            results = []
            
            for idx, stock in enumerate(top_symbols, 1):
                symbol = stock.get('symb', '')
                if not symbol:
                    continue
                
                logger.info(f"\n[{idx}/{len(top_symbols)}] {symbol} 분석 중...")
                
                try:
                    # 종합 점수 계산
                    score_result = self.score_engine.calculate_score(symbol)
                    
                    # KIS 데이터와 병합
                    result = {
                        **score_result,
                        "kis_data": {
                            "price_change": stock.get('prdy_vrss', 0),
                            "price_change_sign": stock.get('prdy_vrss_sign', ''),
                            "volume": stock.get('acml_vol', 0),
                            "market_cap": stock.get('hts_avls', 0)
                        }
                    }
                    
                    results.append(result)
                    
                    # Rate limit 준수
                    time.sleep(0.1)
                
                except Exception as e:
                    logger.error(f"{symbol} 분석 실패: {e}")
                    continue
            
            # 4. 점수순 정렬
            results.sort(key=lambda x: x['total_score'], reverse=True)
            
            self.scan_results = results
            
            logger.info(f"\n{'='*60}")
            logger.info(f"스캔 완료: {len(results)}개 종목 분석")
            logger.info(f"{'='*60}")
            
            # 5. Top 10 출력
            self._print_top_results(results[:10])
            
            return results
        
        except Exception as e:
            logger.error(f"스캔 중 오류 발생: {e}")
            raise
    
    def start_continuous_scan(
        self,
        interval: int = None
    ):
        """
        연속 스캔 시작
        
        Args:
            interval: 스캔 주기 (초), None이면 설정값 사용
        """
        if interval is None:
            interval = config.scanner.scan_interval
        
        self.is_running = True
        logger.info(f"연속 스캔 시작 (주기: {interval}초)")
        
        while self.is_running:
            try:
                # 시장 개장 시간만 스캔
                if self.fmp.is_market_open():
                    logger.info("\n\n>>> 새로운 스캔 시작 <<<")
                    self.scan_once()
                else:
                    logger.info("시장이 폐장 상태입니다. 다음 스캔까지 대기...")
                
                time.sleep(interval)
            
            except KeyboardInterrupt:
                logger.info("사용자에 의해 스캔 중단")
                break
            except Exception as e:
                logger.error(f"스캔 중 오류: {e}")
                time.sleep(interval)
    
    def stop_scan(self):
        """연속 스캔 중단"""
        self.is_running = False
        logger.info("스캔 중단 요청")
    
    def get_top_candidates(
        self,
        min_score: int = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        거래 후보 종목 조회
        
        Args:
            min_score: 최소 점수 (None이면 설정값 사용)
            limit: 결과 개수
        
        Returns:
            후보 종목 리스트
        """
        if min_score is None:
            min_score = config.trading.min_score
        
        # 최소 점수 이상 & 거래 가능한 종목만
        candidates = [
            result for result in self.scan_results
            if result['total_score'] >= min_score and result['is_tradable']
        ]
        
        return candidates[:limit]
    
    
    def get_all_results(self, limit: int = 50) -> List[Dict[str, Any]]:
        """
        모든 스캔 결과 조회 (점수 순)
        
        Args:
            limit: 반환 개수
            
        Returns:
            스캔 결과 리스트
        """
        return self.scan_results[:limit]
    
    
    def scan_once_with_callback(
        self,
        exchange: str = "NAS",
        direction: str = "1",
        timeframe: str = "3",
        volume_filter: str = "3",
        max_symbols: int = 100,
        on_result: Optional[Callable[[Dict[str, Any]], None]] = None
    ) -> List[Dict[str, Any]]:
        """
        1회 스캔 실행 (콜백 지원 - 각 종목 완료 시마다 호출)
        
        Args:
            exchange: 거래소 (NAS, NYS, AMS)
            direction: 0=급락, 1=급등
            timeframe: 시간프레임 (0:1분, 3:5분, 4:10분)
            volume_filter: 거래량 필터 (3:1만주+)
            max_symbols: 최대 조회 종목 수
            on_result: 각 종목 완료 시 호출될 콜백 함수
        
        Returns:
            스캔 결과 리스트
        """
        logger.info(f"\n{'='*60}")
        logger.info(f"급등주 스캔 시작 ({exchange})")
        logger.info(f"{'='*60}")
        
        # 시장 세션 확인
        session_info = get_session_info()
        logger.info(f"📍 시장 상태: {session_info['session_name']} (시간: {session_info['current_time']})")
        logger.info(f"📍 서머타임: {'적용' if session_info['is_dst'] else '미적용'}")
        
        if not session_info['is_trading']:
            logger.warning(f"⚠️ 장마감 시간대입니다. {session_info['next_open']}")
            logger.warning(f"⚠️ 급등주 데이터가 없을 수 있습니다.")
        
        try:
            # 1. KIS API로 급등주 리스트 조회 (여러 timeframe 시도)
            surge_list = []
            
            # 우선순위: 요청한 timeframe → 1분 → 10분 → 15분
            timeframes_to_try = [timeframe]
            if timeframe != "0":
                timeframes_to_try.append("0")  # 1분
            if timeframe != "4":
                timeframes_to_try.append("4")  # 10분
            if timeframe != "5":
                timeframes_to_try.append("5")  # 15분
            
            # volume_filter도 완화 (1만주+ → 1천주+ → 전체)
            volume_filters_to_try = [volume_filter]
            if volume_filter != "2":
                volume_filters_to_try.append("2")  # 1천주+
            if volume_filter != "0":
                volume_filters_to_try.append("0")  # 전체
            
            for tf in timeframes_to_try:
                tf_name = {'0': '1분', '3': '5분', '4': '10분', '5': '15분'}.get(tf, tf)
                
                for vf in volume_filters_to_try:
                    vf_name = {'0': '전체', '1': '100주+', '2': '1천주+', '3': '1만주+'}.get(vf, vf)
                    logger.info(f"급등주 조회 시도: timeframe={tf} ({tf_name}), volume={vf} ({vf_name})")
                    
                    surge_list = self.kis.get_price_surge(
                        exchange=exchange,
                        direction=direction,
                        timeframe=tf,
                        volume_filter=vf
                    )
                    
                    if surge_list:
                        logger.info(f"✅ timeframe={tf} ({tf_name}), volume={vf} ({vf_name})에서 {len(surge_list)}개 급등주 발견")
                        break
                    else:
                        logger.debug(f"timeframe={tf} ({tf_name}), volume={vf} ({vf_name})에서 급등주 없음")
                
                if surge_list:
                    break
            
            if not surge_list:
                logger.warning(f"급등주가 발견되지 않았습니다.")
                logger.warning(f"시도한 조건: timeframe={timeframes_to_try}, volume={volume_filters_to_try}")
                logger.warning("시장이 폐장했거나 거래량이 적은 시간대일 수 있습니다.")
                return []
            
            logger.info(f"급등주 {len(surge_list)}개 발견")
            
            # 2. 상위 N개만 선택
            top_symbols = surge_list[:max_symbols]
            
            # 3. 병렬로 각 종목 분석
            results = []
            
            def analyze_single_stock(idx: int, stock: Dict) -> Optional[Dict]:
                """단일 종목 분석 (병렬 처리용)"""
                symbol = stock.get('symb', '')
                if not symbol:
                    return None
                
                logger.info(f"[{idx}/{len(top_symbols)}] {symbol} 분석 시작")
                
                try:
                    # 종합 점수 계산
                    score_result = self.score_engine.calculate_score(symbol)
                    
                    # KIS 데이터와 병합
                    result = {
                        **score_result,
                        "kis_data": {
                            "price_change": stock.get('prdy_vrss', 0),
                            "price_change_sign": stock.get('prdy_vrss_sign', ''),
                            "volume": stock.get('acml_vol', 0),
                            "market_cap": stock.get('hts_avls', 0)
                        },
                        "progress": {
                            "current": idx,
                            "total": len(top_symbols)
                        }
                    }
                    
                    logger.info(f"✅ [{idx}/{len(top_symbols)}] {symbol} 분석 완료 (점수: {score_result['total_score']:.1f})")
                    return result
                
                except Exception as e:
                    logger.error(f"❌ {symbol} 분석 실패: {e}")
                    return None
            
            # 병렬 처리 (최대 5개 동시 실행)
            logger.info(f"🚀 병렬 분석 시작 (동시 {min(5, len(top_symbols))}개)")
            
            with ThreadPoolExecutor(max_workers=5) as executor:
                # 모든 작업 제출
                future_to_stock = {
                    executor.submit(analyze_single_stock, idx, stock): (idx, stock)
                    for idx, stock in enumerate(top_symbols, 1)
                }
                
                # 완료되는 대로 처리
                for future in as_completed(future_to_stock):
                    try:
                        result = future.result()
                        
                        if result:
                            results.append(result)
                            
                            # 콜백 호출 (완료된 종목 즉시 전송)
                            if on_result:
                                on_result(result)
                    
                    except Exception as e:
                        logger.error(f"병렬 처리 중 오류: {e}")
            
            # 4. 점수순 정렬
            results.sort(key=lambda x: x['total_score'], reverse=True)
            
            self.scan_results = results
            
            logger.info(f"\n{'='*60}")
            logger.info(f"스캔 완료: {len(results)}개 종목 분석")
            logger.info(f"{'='*60}")
            
            # 5. Top 10 출력
            self._print_top_results(results[:10])
            
            return results
        
        except Exception as e:
            logger.error(f"스캔 중 오류 발생: {e}")
            raise
    
    def _print_top_results(self, results: List[Dict[str, Any]]):
        """
        상위 결과 출력
        
        Args:
            results: 스캔 결과 리스트
        """
        print(f"\n{'='*80}")
        print(f"{'Rank':<6} {'Symbol':<8} {'Score':<8} {'Tech':<7} {'News':<7} {'Fund':<7} {'Tradable'}")
        print(f"{'='*80}")
        
        for idx, result in enumerate(results, 1):
            symbol = result['symbol']
            total = result['total_score']
            tech = result['scores']['technical']
            news = result['scores']['news']
            fund = result['scores']['fundamental']
            tradable = "✓" if result['is_tradable'] else "✗"
            
            print(f"{idx:<6} {symbol:<8} {total:<8.1f} {tech:<7.1f} {news:<7.1f} {fund:<7.1f} {tradable}")
        
        print(f"{'='*80}\n")


if __name__ == "__main__":
    """테스트 코드"""
    from loguru import logger
    from typing import Optional
    
    # 로깅 설정
    logger.add("logs/surge_scanner_test.log", rotation="1 day")
    
    # 스캐너 생성
    scanner = SurgeScanner()
    
    # 1회 스캔 실행
    print("\n=== 나스닥 급등주 스캔 ===")
    results = scanner.scan_once(
        exchange="NAS",
        direction="1",  # 급등
        timeframe="3",  # 5분전
        volume_filter="3",  # 1만주+
        max_symbols=20  # 테스트용 20개만
    )
    
    # 거래 후보 조회
    print("\n=== 거래 후보 종목 (점수 70+ & 거래 가능) ===")
    candidates = scanner.get_top_candidates(min_score=70, limit=5)
    
    for idx, candidate in enumerate(candidates, 1):
        print(f"\n[{idx}] {candidate['symbol']}")
        print(f"  총점: {candidate['total_score']}/100")
        print(f"  예상 수익률 (P50): {candidate['expected_returns']['p50']}%")
        
        # 목표가
        quote = scanner.fmp.get_quote(candidate['symbol'])
        current_price = quote.get('price', 0)
        targets = scanner.score_engine.calculate_targets(
            candidate['symbol'],
            current_price,
            candidate['total_score']
        )
        print(f"  현재가: ${current_price:.2f}")
        print(f"  익절: ${targets['take_profit_price']:.2f}")
        print(f"  손절: ${targets['stop_loss_price']:.2f}")

