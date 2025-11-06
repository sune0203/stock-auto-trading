"""
Financial Modeling Prep API 클라이언트
실시간 시세, 차트 데이터, 펀더멘털 정보 제공
"""

import time
import requests
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
from loguru import logger
from config import config


class FMPAPIClient:
    """Financial Modeling Prep API 클라이언트"""
    
    def __init__(self):
        self.base_url = config.fmp.base_url
        self.api_key = config.fmp.api_key
        
        # Rate limit 관리
        self.request_count = 0
        self.request_window_start = time.time()
        self.max_requests_per_minute = config.fmp.requests_per_minute
        
        logger.info(f"FMP API Client 초기화 (Rate Limit: {self.max_requests_per_minute}/min)")
    
    def _wait_for_rate_limit(self):
        """Rate limit 준수를 위한 대기"""
        current_time = time.time()
        elapsed = current_time - self.request_window_start
        
        # 1분이 지났으면 카운터 리셋
        if elapsed >= 60:
            self.request_count = 0
            self.request_window_start = current_time
        
        # Rate limit에 도달했으면 대기
        if self.request_count >= self.max_requests_per_minute:
            wait_time = 60 - elapsed
            if wait_time > 0:
                logger.warning(f"Rate limit 도달, {wait_time:.1f}초 대기...")
                time.sleep(wait_time)
                self.request_count = 0
                self.request_window_start = time.time()
    
    def _request(self, endpoint: str, params: Optional[Dict] = None) -> Any:
        """
        API 요청 실행
        
        Args:
            endpoint: API 엔드포인트
            params: 쿼리 파라미터
        
        Returns:
            API 응답 데이터
        """
        self._wait_for_rate_limit()
        
        url = f"{self.base_url}{endpoint}"
        
        # API 키 추가
        if params is None:
            params = {}
        params["apikey"] = self.api_key
        
        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            
            self.request_count += 1
            
            data = response.json()
            
            # 에러 체크
            if isinstance(data, dict) and "Error Message" in data:
                error_msg = data["Error Message"]
                logger.error(f"FMP API 에러: {error_msg}")
                raise Exception(f"FMP API Error: {error_msg}")
            
            return data
        
        except requests.exceptions.RequestException as e:
            logger.error(f"API 요청 실패 ({endpoint}): {e}")
            raise
    
    # ========== 실시간 시세 ==========
    
    def get_quote(self, symbol: str) -> Dict[str, Any]:
        """
        단일 종목 실시간 시세
        
        Args:
            symbol: 종목 심볼
        
        Returns:
            시세 정보
        """
        endpoint = f"/quote?symbol={symbol}"
        result = self._request(endpoint)
        
        if isinstance(result, list) and len(result) > 0:
            return result[0]
        return {}
    
    def get_batch_quotes(self, symbols: List[str]) -> List[Dict[str, Any]]:
        """
        다중 종목 실시간 시세 (정규장, 최대 100개)
        
        Args:
            symbols: 종목 심볼 리스트 (최대 100개)
        
        Returns:
            시세 정보 리스트
        """
        if not symbols:
            logger.warning("배치 시세 조회: 심볼 리스트가 비어있음")
            return []
        
        if len(symbols) > 100:
            logger.warning(f"심볼 개수가 100개를 초과합니다. 처음 100개만 조회합니다.")
            symbols = symbols[:100]
        
        # 콤마로 구분된 심볼 리스트
        symbols_str = ",".join(symbols)
        logger.debug(f"배치 시세 조회 요청: {len(symbols)}개 종목 - {symbols_str[:100]}...")
        
        # FMP batch-quote API: /batch-quote?symbols=AAPL,MSFT&apikey=xxx
        endpoint = f"/batch-quote?symbols={symbols_str}"
        
        try:
            result = self._request(endpoint)
            
            if isinstance(result, list) and len(result) > 0:
                logger.debug(f"✅ 배치 시세 조회 완료: {len(result)}개")
                return result
            elif isinstance(result, dict) and "Error Message" in result:
                logger.error(f"FMP API 에러: {result['Error Message']}")
                return []
            else:
                logger.warning(f"배치 시세 조회 결과 없음 (응답 타입: {type(result)})")
                return []
        
        except Exception as e:
            logger.error(f"배치 시세 조회 실패 ({len(symbols)}개 종목): {e}")
            return []
    
    
    def get_batch_aftermarket_quotes(self, symbols: List[str]) -> List[Dict[str, Any]]:
        """
        다중 종목 시간외 거래 시세 (프리/애프터마켓, 최대 100개)
        
        Args:
            symbols: 종목 심볼 리스트 (최대 100개)
        
        Returns:
            시간외 시세 정보 리스트
        """
        if not symbols:
            logger.warning("시간외 배치 시세 조회: 심볼 리스트가 비어있음")
            return []
        
        if len(symbols) > 100:
            logger.warning(f"심볼 개수가 100개를 초과합니다. 처음 100개만 조회합니다.")
            symbols = symbols[:100]
        
        # 콤마로 구분된 심볼 리스트
        symbols_str = ",".join(symbols)
        logger.debug(f"시간외 배치 시세 조회 요청: {len(symbols)}개 종목")
        
        # FMP batch-aftermarket-trade API: /batch-aftermarket-trade?symbols=AAPL,MSFT&apikey=xxx
        endpoint = f"/batch-aftermarket-trade?symbols={symbols_str}"
        
        try:
            result = self._request(endpoint)
            
            if isinstance(result, list) and len(result) > 0:
                logger.debug(f"✅ 시간외 배치 시세 조회 완료: {len(result)}개")
                return result
            else:
                logger.warning(f"시간외 배치 시세 조회 결과 없음")
                return []
        
        except Exception as e:
            logger.error(f"시간외 배치 시세 조회 실패: {e}")
            return []
    
    def get_aftermarket_quote(self, symbol: str) -> Dict[str, Any]:
        """
        시간외 거래 시세 (애프터마켓)
        
        Args:
            symbol: 종목 심볼
        
        Returns:
            시간외 시세 정보 (bidPrice, askPrice, volume 등)
        """
        endpoint = f"/aftermarket-quote?symbol={symbol}"
        result = self._request(endpoint)
        
        if isinstance(result, list) and len(result) > 0:
            return result[0]
        return {}
    
    def get_batch_aftermarket_quotes(self, symbols: List[str]) -> List[Dict[str, Any]]:
        """
        다중 종목 시간외 시세 (최대 100개)
        
        Args:
            symbols: 종목 심볼 리스트
        
        Returns:
            시간외 시세 정보 리스트
        """
        if len(symbols) > 100:
            symbols = symbols[:100]
        
        symbols_str = ",".join(symbols)
        endpoint = f"/batch-aftermarket-quote?symbols={symbols_str}"
        
        result = self._request(endpoint)
        logger.info(f"배치 시간외 시세 조회 완료: {len(result)}개")
        
        return result if isinstance(result, list) else []
    
    # ========== 차트 데이터 ==========
    
    def get_intraday_chart(
        self,
        symbol: str,
        interval: str = "5min",  # 1min, 5min, 15min, 30min, 1hour
        from_date: Optional[str] = None,
        to_date: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        분봉 차트 데이터
        
        Args:
            symbol: 종목 심볼
            interval: 시간 간격 (1min, 5min, 15min, 30min, 1hour, 4hour)
            from_date: 시작일 (YYYY-MM-DD)
            to_date: 종료일 (YYYY-MM-DD)
        
        Returns:
            OHLCV 데이터 리스트
        """
        endpoint = f"/historical-chart/{interval}?symbol={symbol}"
        
        params = {}
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date
        
        result = self._request(endpoint, params)
        
        if isinstance(result, list):
            logger.info(f"{symbol} {interval} 차트 조회: {len(result)}개")
            return result
        return []
    
    def get_daily_chart(
        self,
        symbol: str,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        일봉 차트 데이터
        
        Args:
            symbol: 종목 심볼
            from_date: 시작일 (YYYY-MM-DD)
            to_date: 종료일 (YYYY-MM-DD)
        
        Returns:
            일봉 OHLCV 데이터 리스트
        """
        endpoint = f"/historical-price-eod/full?symbol={symbol}"
        
        params = {}
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date
        
        result = self._request(endpoint, params)
        
        if isinstance(result, list):
            logger.info(f"{symbol} 일봉 차트 조회: {len(result)}개")
            return result
        return []
    
    # ========== 펀더멘털 데이터 ==========
    
    def get_company_profile(self, symbol: str) -> Dict[str, Any]:
        """
        기업 프로필 정보
        
        Args:
            symbol: 종목 심볼
        
        Returns:
            기업 정보 (industry, sector, CEO, employees 등)
        """
        endpoint = f"/profile?symbol={symbol}"
        result = self._request(endpoint)
        
        if isinstance(result, list) and len(result) > 0:
            return result[0]
        return {}
    
    def get_key_metrics(self, symbol: str) -> Dict[str, Any]:
        """
        주요 지표
        
        Args:
            symbol: 종목 심볼
        
        Returns:
            주요 재무 지표 (marketCap, PE, EPS, sharesOutstanding 등)
        """
        endpoint = f"/key-metrics?symbol={symbol}"
        result = self._request(endpoint)
        
        if isinstance(result, list) and len(result) > 0:
            return result[0]
        return {}
    
    def get_float_shares(self, symbol: str) -> Optional[int]:
        """
        유동주식수 조회
        
        Args:
            symbol: 종목 심볼
        
        Returns:
            유동주식수
        """
        profile = self.get_company_profile(symbol)
        
        # floatShares가 없으면 sharesOutstanding 사용
        float_shares = profile.get("floatShares")
        if float_shares is None:
            float_shares = profile.get("sharesOutstanding")
        
        return float_shares
    
    def get_short_interest(self, symbol: str) -> Dict[str, Any]:
        """
        공매도 정보
        
        Args:
            symbol: 종목 심볼
        
        Returns:
            공매도 잔량 및 비율
        """
        # FMP는 공매도 데이터를 제공하지 않을 수 있음
        # 대안: FINRA 데이터 활용 (별도 구현 필요)
        logger.warning("FMP에서 실시간 공매도 데이터는 제한적입니다.")
        return {}
    
    # ========== 검색 ==========
    
    def search_symbol(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        종목 검색
        
        Args:
            query: 검색어 (심볼 또는 회사명)
            limit: 결과 개수
        
        Returns:
            검색 결과 리스트
        """
        endpoint = f"/search-symbol?query={query}&limit={limit}"
        result = self._request(endpoint)
        
        if isinstance(result, list):
            return result
        return []
    
    # ========== 유틸리티 ==========
    
    def is_market_open(self) -> bool:
        """
        현재 시장 개장 여부 확인
        
        Returns:
            개장 여부
        """
        # 간단한 시간 체크 (ET 기준)
        # 실제로는 더 정교한 로직 필요 (휴일, 조기 마감 등)
        now_et = datetime.utcnow() - timedelta(hours=5)  # UTC to ET (EST)
        
        market_open = config.market_hours.market_open.split(":")
        market_close = config.market_hours.market_close.split(":")
        
        open_time = now_et.replace(hour=int(market_open[0]), minute=int(market_open[1]), second=0)
        close_time = now_et.replace(hour=int(market_close[0]), minute=int(market_close[1]), second=0)
        
        # 평일 체크 (0=월요일, 6=일요일)
        if now_et.weekday() >= 5:  # 토요일 또는 일요일
            return False
        
        return open_time <= now_et <= close_time
    
    def should_use_aftermarket_api(self) -> bool:
        """
        시간외 API 사용 여부 결정
        
        Returns:
            시간외 API 사용 여부
        """
        return not self.is_market_open()


if __name__ == "__main__":
    """테스트 코드"""
    from loguru import logger
    
    # 로깅 설정
    logger.add("logs/fmp_client_test.log", rotation="1 day")
    
    # 클라이언트 생성
    client = FMPAPIClient()
    
    # 시장 상태 확인
    print(f"\n=== 시장 상태 ===")
    print(f"개장 여부: {client.is_market_open()}")
    print(f"시간외 API 사용: {client.should_use_aftermarket_api()}")
    
    # 실시간 시세 조회
    print(f"\n=== AAPL 실시간 시세 ===")
    quote = client.get_quote("AAPL")
    if quote:
        print(f"Price: ${quote.get('price')}")
        print(f"Change: {quote.get('change')} ({quote.get('changePercentage')}%)")
        print(f"Volume: {quote.get('volume'):,}")
    
    # 배치 시세 조회
    print(f"\n=== 배치 시세 조회 ===")
    symbols = ["AAPL", "NVDA", "TSLA", "MSFT", "GOOGL"]
    quotes = client.get_batch_quotes(symbols)
    for q in quotes:
        print(f"{q.get('symbol')}: ${q.get('price')} ({q.get('changePercentage')}%)")
    
    # 5분봉 차트
    print(f"\n=== AAPL 5분봉 차트 (최근 10개) ===")
    chart = client.get_intraday_chart("AAPL", "5min")
    for candle in chart[:10]:
        print(f"{candle.get('date')}: O={candle.get('open')} H={candle.get('high')} L={candle.get('low')} C={candle.get('close')}")
    
    # 유동주식수
    print(f"\n=== AAPL 유동주식수 ===")
    float_shares = client.get_float_shares("AAPL")
    print(f"Float Shares: {float_shares:,}")

