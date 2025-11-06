"""
실시간 모니터링 엔진
종목 리스트의 현재가, 상승률, 거래량 등을 지속적으로 추적
"""

import time
from typing import Dict, List, Optional, Set
from datetime import datetime
from loguru import logger
import threading
from collections import defaultdict

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from api.fmp_client import FMPAPIClient
from scanner.surge_scanner import get_market_session


class RealtimeMonitor:
    """실시간 모니터링 엔진"""
    
    def __init__(self, fmp_client: FMPAPIClient, score_engine=None):
        self.fmp = fmp_client
        self.score_engine = score_engine  # 현재 사용하지 않지만 확장성을 위해 추가
        
        # 모니터링 대상 종목 리스트
        self.watchlist: Set[str] = set()
        
        # 현재 가격 데이터
        self.current_prices: Dict[str, Dict] = {}
        
        # 초기 가격 (상승률 계산용)
        self.initial_prices: Dict[str, float] = {}
        
        # 모니터링 스레드
        self.monitor_thread: Optional[threading.Thread] = None
        self.is_running = False
        
        # 업데이트 간격 (초)
        self.update_interval = 5  # FMP API는 5초마다 업데이트 가능
        
        # 콜백 함수들
        self.callbacks: List[callable] = []
        
        logger.info("실시간 모니터 초기화 완료")
    
    
    def add_symbols(self, symbols: List[str]) -> None:
        """
        모니터링 종목 추가
        
        Args:
            symbols: 추가할 종목 심볼 리스트
        """
        new_symbols = set(symbols) - self.watchlist
        
        if new_symbols:
            logger.info(f"{len(new_symbols)}개 종목 추가: {', '.join(sorted(new_symbols))}")
            
            # 시장 세션 확인
            session = get_market_session()
            
            # 초기 가격 설정 (배치로 한번에 가져오기)
            new_symbols_list = list(new_symbols)
            try:
                if session == "RTH":
                    quotes = self.fmp.get_batch_quotes(new_symbols_list)
                else:
                    quotes = self.fmp.get_batch_aftermarket_quotes(new_symbols_list)
                
                if quotes:
                    for quote in quotes:
                        symbol = quote.get('symbol')
                        if not symbol or symbol in self.initial_prices:
                            continue
                        
                        # 세션에 따라 가격 필드 처리
                        if session == "RTH":
                            price = quote.get('price', 0)
                        else:
                            price = quote.get('price', 0) or quote.get('lastPrice', 0)
                        
                        if price > 0:
                            self.initial_prices[symbol] = price
                            logger.debug(f"{symbol} 초기 가격: ${price:.2f} (session={session})")
                else:
                    logger.warning(f"초기 가격 배치 조회 실패 (session={session})")
            
            except Exception as e:
                logger.error(f"초기 가격 설정 실패: {e}")
            
            self.watchlist.update(new_symbols)
    
    
    def remove_symbols(self, symbols: List[str]) -> None:
        """
        모니터링 종목 제거
        
        Args:
            symbols: 제거할 종목 심볼 리스트
        """
        removed = self.watchlist.intersection(symbols)
        if removed:
            logger.info(f"{len(removed)}개 종목 제거: {', '.join(sorted(removed))}")
            self.watchlist -= removed
            
            for symbol in removed:
                self.current_prices.pop(symbol, None)
                # 초기 가격은 유지 (재추가 시 참고용)
    
    
    def clear_watchlist(self) -> None:
        """모든 모니터링 종목 제거"""
        logger.info("모든 모니터링 종목 제거")
        self.watchlist.clear()
        self.current_prices.clear()
    
    
    def register_callback(self, callback: callable) -> None:
        """
        업데이트 콜백 함수 등록
        
        Args:
            callback: 업데이트 시 호출될 함수 (data: Dict 인자 받음)
        """
        if callback not in self.callbacks:
            self.callbacks.append(callback)
            logger.info(f"콜백 등록: {callback.__name__}")
    
    
    def start(self) -> None:
        """모니터링 시작"""
        if self.is_running:
            logger.warning("이미 모니터링 중입니다")
            return
        
        logger.info("실시간 모니터링 시작")
        self.is_running = True
        
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
    
    
    def stop(self) -> None:
        """모니터링 중지"""
        if not self.is_running:
            return
        
        logger.info("실시간 모니터링 중지")
        self.is_running = False
        
        if self.monitor_thread:
            self.monitor_thread.join(timeout=10)
    
    
    def _monitor_loop(self) -> None:
        """모니터링 루프 (백그라운드 스레드)"""
        logger.info("모니터링 루프 시작")
        
        while self.is_running:
            try:
                if not self.watchlist:
                    time.sleep(1)
                    continue
                
                # 현재가 업데이트
                self._update_prices()
                
                # 콜백 호출
                self._trigger_callbacks()
                
                # 대기
                time.sleep(self.update_interval)
                
            except Exception as e:
                logger.error(f"모니터링 루프 오류: {e}")
                time.sleep(5)
        
        logger.info("모니터링 루프 종료")
    
    
    def _update_prices(self) -> None:
        """현재가 업데이트 (시장 세션에 따라 적절한 API 사용)"""
        if not self.watchlist:
            return
        
        # 배치 요청으로 한번에 가져오기
        symbols_list = list(self.watchlist)
        
        try:
            # 시장 세션 확인
            session = get_market_session()
            
            # 세션에 따라 적절한 API 사용
            if session == "RTH":
                # 정규장: batch-quote
                quotes = self.fmp.get_batch_quotes(symbols_list)
                logger.debug(f"정규장 API 사용 (batch-quote)")
            else:
                # 프리마켓/애프터마켓: batch-aftermarket-trade
                quotes = self.fmp.get_batch_aftermarket_quotes(symbols_list)
                logger.debug(f"{session} API 사용 (batch-aftermarket-trade)")
            
            if not quotes:
                logger.warning(f"가격 데이터 없음 (session={session})")
                return
            
            # 데이터 파싱
            for quote in quotes:
                symbol = quote.get('symbol')
                if not symbol or symbol not in self.watchlist:
                    continue
                
                # batch-quote와 batch-aftermarket-trade 응답 구조 차이 처리
                if session == "RTH":
                    # batch-quote 응답 구조
                    price = quote.get('price', 0)
                    change_pct = quote.get('changesPercentage', 0)
                    volume = quote.get('volume', 0)
                else:
                    # batch-aftermarket-trade 응답 구조 (응답 필드가 다를 수 있음)
                    price = quote.get('price', 0) or quote.get('lastPrice', 0)
                    change_pct = quote.get('changesPercentage', 0) or quote.get('changePercent', 0)
                    volume = quote.get('volume', 0) or quote.get('totalVolume', 0)
                
                if price == 0:
                    continue  # 가격 데이터 없으면 스킵
                
                # 초기 가격 대비 상승률 계산
                if symbol in self.initial_prices and self.initial_prices[symbol] > 0:
                    gain_pct = ((price - self.initial_prices[symbol]) / self.initial_prices[symbol]) * 100
                else:
                    gain_pct = 0
                
                # 현재 데이터 저장
                self.current_prices[symbol] = {
                    'symbol': symbol,
                    'price': price,
                    'change_pct': change_pct,  # 전일 대비
                    'gain_pct': gain_pct,  # 진입가 대비
                    'volume': volume,
                    'timestamp': datetime.now().isoformat(),
                    'initial_price': self.initial_prices.get(symbol, price),
                    'session': session  # 세션 정보 추가
                }
            
            logger.debug(f"{len(quotes)}개 종목 가격 업데이트 완료 (session={session})")
            
        except Exception as e:
            logger.error(f"가격 업데이트 실패: {e}")
    
    
    def _trigger_callbacks(self) -> None:
        """등록된 콜백 함수 호출"""
        if not self.callbacks or not self.current_prices:
            return
        
        data = {
            'timestamp': datetime.now().isoformat(),
            'count': len(self.current_prices),
            'prices': list(self.current_prices.values())
        }
        
        for callback in self.callbacks:
            try:
                callback(data)
            except Exception as e:
                logger.error(f"콜백 실행 실패 ({callback.__name__}): {e}")
    
    
    def get_current_data(self) -> Dict:
        """
        현재 모니터링 데이터 조회
        
        Returns:
            Dict: 현재 가격 데이터
        """
        return {
            'timestamp': datetime.now().isoformat(),
            'count': len(self.current_prices),
            'watchlist_size': len(self.watchlist),
            'prices': list(self.current_prices.values())
        }
    
    
    def get_symbol_data(self, symbol: str) -> Optional[Dict]:
        """
        특정 종목 데이터 조회
        
        Args:
            symbol: 종목 심볼
            
        Returns:
            Optional[Dict]: 종목 데이터 (없으면 None)
        """
        return self.current_prices.get(symbol)
    
    
    def get_top_gainers(self, limit: int = 10) -> List[Dict]:
        """
        상승률 상위 종목
        
        Args:
            limit: 반환 개수
            
        Returns:
            List[Dict]: 상승률 상위 종목
        """
        sorted_data = sorted(
            self.current_prices.values(),
            key=lambda x: x.get('gain_pct', 0),
            reverse=True
        )
        
        return sorted_data[:limit]
    
    
    def get_top_losers(self, limit: int = 10) -> List[Dict]:
        """
        하락률 상위 종목
        
        Args:
            limit: 반환 개수
            
        Returns:
            List[Dict]: 하락률 상위 종목
        """
        sorted_data = sorted(
            self.current_prices.values(),
            key=lambda x: x.get('gain_pct', 0)
        )
        
        return sorted_data[:limit]
    
    
    def reset_initial_prices(self) -> None:
        """초기 가격 초기화 (현재가를 새 기준으로)"""
        logger.info("초기 가격 재설정")
        for symbol, data in self.current_prices.items():
            self.initial_prices[symbol] = data.get('price', 0)


    def get_top_gainers(self, limit: int = 10) -> List[Dict]:
        """
        상승률 상위 종목
        
        Args:
            limit: 반환 개수
            
        Returns:
            List[Dict]: 상승률 상위 종목
        """
        sorted_data = sorted(
            self.current_prices.values(),
            key=lambda x: x.get('gain_pct', 0),
            reverse=True
        )
        
        return sorted_data[:limit]
    
    
    def get_top_losers(self, limit: int = 10) -> List[Dict]:
        """
        하락률 상위 종목
        
        Args:
            limit: 반환 개수
            
        Returns:
            List[Dict]: 하락률 상위 종목
        """
        sorted_data = sorted(
            self.current_prices.values(),
            key=lambda x: x.get('gain_pct', 0)
        )
        
        return sorted_data[:limit]
    
    
    def reset_initial_prices(self) -> None:
        """초기 가격 초기화 (현재가를 새 기준으로)"""
        logger.info("초기 가격 재설정")
        for symbol, data in self.current_prices.items():
            self.initial_prices[symbol] = data.get('price', 0)

