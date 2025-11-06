"""
한국투자증권 API 클라이언트
급등주 스캔 및 주문 기능 제공
"""

import time
import requests
from typing import Optional, Dict, List, Any
from loguru import logger
from config import config


class KISAPIClient:
    """한국투자증권 OpenAPI 클라이언트"""
    
    def __init__(self):
        self.base_url = config.kis.base_url
        self.app_key = config.kis.app_key
        self.app_secret = config.kis.app_secret
        self.account_no = config.kis.account_no
        self.use_mock = config.kis.use_mock
        
        # 토큰 관리
        self.access_token: Optional[str] = None
        self.token_expired_at: Optional[float] = None
        
        # Rate limit 관리
        self.last_request_time = 0
        self.min_request_interval = 1.0 / config.rate_limit.kis_requests_per_second
        
        logger.info(f"KIS API Client 초기화 (Mock: {self.use_mock})")
    
    def _wait_for_rate_limit(self):
        """Rate limit 준수를 위한 대기"""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.min_request_interval:
            time.sleep(self.min_request_interval - elapsed)
        self.last_request_time = time.time()
    
    def _get_headers(self, tr_id: str, tr_cont: str = "") -> Dict[str, str]:
        """API 요청 헤더 생성"""
        if not self.access_token or (self.token_expired_at and time.time() >= self.token_expired_at):
            self._refresh_token()
        
        return {
            "content-type": "application/json; charset=utf-8",
            "authorization": f"Bearer {self.access_token}",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
            "tr_id": tr_id,
            "tr_cont": tr_cont,
            "custtype": "P"  # 개인
        }
    
    def _refresh_token(self):
        """접근 토큰 갱신"""
        url = f"{self.base_url}/oauth2/tokenP"
        
        body = {
            "grant_type": "client_credentials",
            "appkey": self.app_key,
            "appsecret": self.app_secret
        }
        
        try:
            response = requests.post(url, json=body)
            response.raise_for_status()
            
            data = response.json()
            self.access_token = data["access_token"]
            # 토큰 만료 시간 (24시간 - 1시간 여유)
            self.token_expired_at = time.time() + (23 * 3600)
            
            logger.info("접근 토큰 갱신 완료")
        except Exception as e:
            logger.error(f"토큰 갱신 실패: {e}")
            raise
    
    def _request(
        self,
        method: str,
        endpoint: str,
        tr_id: str,
        params: Optional[Dict] = None,
        data: Optional[Dict] = None,
        tr_cont: str = ""
    ) -> Dict[str, Any]:
        """
        API 요청 실행
        
        Args:
            method: HTTP 메서드 (GET, POST)
            endpoint: API 엔드포인트
            tr_id: 거래 ID
            params: 쿼리 파라미터
            data: 요청 바디
            tr_cont: 연속 조회 구분
        
        Returns:
            API 응답 데이터
        """
        self._wait_for_rate_limit()
        
        url = f"{self.base_url}{endpoint}"
        headers = self._get_headers(tr_id, tr_cont)
        
        try:
            if method == "GET":
                response = requests.get(url, headers=headers, params=params)
            elif method == "POST":
                response = requests.post(url, headers=headers, json=data, params=params)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            response.raise_for_status()
            result = response.json()
            
            # 에러 체크
            if result.get("rt_cd") != "0":
                error_msg = result.get("msg1", "Unknown error")
                logger.error(f"API 에러: {error_msg}")
                raise Exception(f"KIS API Error: {error_msg}")
            
            return result
        
        except requests.exceptions.RequestException as e:
            logger.error(f"API 요청 실패 ({endpoint}): {e}")
            raise
    
    # ========== 시세 조회 ==========
    
    def get_price_surge(
        self,
        exchange: str = "NAS",  # NYS, NAS, AMS
        direction: str = "1",   # 0: 급락, 1: 급등
        timeframe: str = "0",   # 0:1분, 1:2분, 2:3분, 3:5분, 4:10분, ...
        volume_filter: str = "3"  # 0:전체, 1:100주+, 2:1천주+, 3:1만주+, ...
    ) -> List[Dict[str, Any]]:
        """
        가격 급등락 종목 조회
        
        Args:
            exchange: 거래소 (NYS, NAS, AMS, HKS, SHS, SZS, HSX, HNX, TSE)
            direction: 0=급락, 1=급등
            timeframe: N분전 (0:1분, 1:2분, 2:3분, 3:5분, 4:10분, 5:15분, 6:20분, 7:30분, 8:60분, 9:120분)
            volume_filter: 거래량 조건 (0:전체, 1:100주+, 2:1천주+, 3:1만주+, 4:10만주+, 5:100만주+, 6:1000만주+)
        
        Returns:
            급등락 종목 리스트
        """
        endpoint = "/uapi/overseas-stock/v1/ranking/price-fluct"
        tr_id = "HHDFS76260000"
        
        params = {
            "EXCD": exchange,
            "GUBN": direction,
            "MIXN": timeframe,
            "VOL_RANG": volume_filter,
            "KEYB": "",
            "AUTH": ""
        }
        
        try:
            result = self._request("GET", endpoint, tr_id, params=params)
            
            # 응답 구조 확인
            logger.debug(f"KIS API 응답 구조: {list(result.keys())}")
            
            # output2에 종목 리스트가 있음
            symbols = result.get("output2", [])
            
            if not symbols:
                # output1도 확인
                output1 = result.get("output1", [])
                if output1:
                    logger.warning(f"output2가 비어있지만 output1에 {len(output1)}개 항목 발견")
                    symbols = output1
                
                # 전체 응답 로깅 (디버깅용)
                logger.debug(f"전체 API 응답: {result}")
            
            logger.info(f"급등주 조회 완료: {len(symbols)}개 (파라미터: EXCD={exchange}, GUBN={direction}, MIXN={timeframe}, VOL_RANG={volume_filter})")
            
            return symbols
        
        except Exception as e:
            logger.error(f"급등주 조회 실패: {e}")
            logger.error(f"파라미터: EXCD={exchange}, GUBN={direction}, MIXN={timeframe}, VOL_RANG={volume_filter}")
            raise
    
    def get_volume_surge(
        self,
        exchange: str = "NAS",
        volume_filter: str = "3"
    ) -> List[Dict[str, Any]]:
        """
        거래량 급증 종목 조회
        
        Args:
            exchange: 거래소
            volume_filter: 거래량 조건
        
        Returns:
            거래량 급증 종목 리스트
        """
        endpoint = "/uapi/overseas-stock/v1/ranking/volume-surge"
        tr_id = "HHDFSCR9500"  # 실제 TR ID는 확인 필요
        
        params = {
            "EXCD": exchange,
            "VOL_RANG": volume_filter,
            "KEYB": "",
            "AUTH": ""
        }
        
        result = self._request("GET", endpoint, tr_id, params=params)
        symbols = result.get("output2", [])
        logger.info(f"거래량 급증 조회 완료: {len(symbols)}개")
        
        return symbols
    
    def get_quote(
        self,
        symbol: str,
        exchange: str = "NAS"
    ) -> Dict[str, Any]:
        """
        해외주식 현재가 조회
        
        Args:
            symbol: 종목 심볼
            exchange: 거래소
        
        Returns:
            현재가 정보
        """
        endpoint = "/uapi/overseas-price/v1/quotations/price"
        tr_id = "HHDFS00000300"
        
        params = {
            "AUTH": "",
            "EXCD": exchange,
            "SYMB": symbol
        }
        
        result = self._request("GET", endpoint, tr_id, params=params)
        return result.get("output", {})
    
    def get_asking_price(
        self,
        symbol: str,
        exchange: str = "NAS"
    ) -> Dict[str, Any]:
        """
        해외주식 호가 조회
        
        Args:
            symbol: 종목 심볼
            exchange: 거래소
        
        Returns:
            호가 정보
        """
        endpoint = "/uapi/overseas-price/v1/quotations/inquire-asking-price"
        tr_id = "HHDFS00000200"
        
        params = {
            "AUTH": "",
            "EXCD": exchange,
            "SYMB": symbol
        }
        
        result = self._request("GET", endpoint, tr_id, params=params)
        return result.get("output", {})
    
    # ========== 주문 ==========
    
    def order_buy(
        self,
        symbol: str,
        quantity: int,
        price: Optional[float] = None,
        exchange: str = "NAS"
    ) -> Dict[str, Any]:
        """
        해외주식 매수 주문
        
        Args:
            symbol: 종목 심볼
            quantity: 수량
            price: 가격 (None이면 시장가)
            exchange: 거래소
        
        Returns:
            주문 결과
        """
        endpoint = "/uapi/overseas-stock/v1/trading/order"
        
        # 모의투자 / 실전투자 TR ID 분기
        tr_id = "VTTT1002U" if self.use_mock else "TTTT1002U"
        
        # 시장가 / 지정가 구분
        order_type = "00" if price is None else "00"  # 00: 지정가
        price_str = "0" if price is None else str(price)
        
        data = {
            "CANO": self.account_no.split("-")[0],  # 계좌번호 앞자리
            "ACNT_PRDT_CD": self.account_no.split("-")[1],  # 계좌번호 뒷자리
            "OVRS_EXCG_CD": exchange,
            "PDNO": symbol,
            "ORD_QTY": str(quantity),
            "OVRS_ORD_UNPR": price_str,
            "ORD_SVR_DVSN_CD": "0",  # 0: 해외주식
            "ORD_DVSN": order_type
        }
        
        try:
            result = self._request("POST", endpoint, tr_id, data=data)
            logger.info(f"매수 주문 완료: {symbol} x {quantity} @ {price or 'MARKET'}")
            return result
        except Exception as e:
            logger.error(f"매수 주문 실패: {e}")
            raise
    
    def order_sell(
        self,
        symbol: str,
        quantity: int,
        price: Optional[float] = None,
        exchange: str = "NAS"
    ) -> Dict[str, Any]:
        """
        해외주식 매도 주문
        
        Args:
            symbol: 종목 심볼
            quantity: 수량
            price: 가격 (None이면 시장가)
            exchange: 거래소
        
        Returns:
            주문 결과
        """
        endpoint = "/uapi/overseas-stock/v1/trading/order"
        
        # 모의투자 / 실전투자 TR ID 분기
        tr_id = "VTTT1001U" if self.use_mock else "TTTT1001U"
        
        # 시장가 / 지정가 구분
        order_type = "00" if price is None else "00"
        price_str = "0" if price is None else str(price)
        
        data = {
            "CANO": self.account_no.split("-")[0],
            "ACNT_PRDT_CD": self.account_no.split("-")[1],
            "OVRS_EXCG_CD": exchange,
            "PDNO": symbol,
            "ORD_QTY": str(quantity),
            "OVRS_ORD_UNPR": price_str,
            "ORD_SVR_DVSN_CD": "0",
            "ORD_DVSN": order_type
        }
        
        try:
            result = self._request("POST", endpoint, tr_id, data=data)
            logger.info(f"매도 주문 완료: {symbol} x {quantity} @ {price or 'MARKET'}")
            return result
        except Exception as e:
            logger.error(f"매도 주문 실패: {e}")
            raise
    
    def get_balance(self) -> List[Dict[str, Any]]:
        """
        해외주식 잔고 조회
        
        Returns:
            보유 종목 리스트
        """
        endpoint = "/uapi/overseas-stock/v1/trading/inquire-balance"
        tr_id = "VTTS3012R" if self.use_mock else "TTTS3012R"
        
        params = {
            "CANO": self.account_no.split("-")[0],
            "ACNT_PRDT_CD": self.account_no.split("-")[1],
            "OVRS_EXCG_CD": "NASD",  # 나스닥
            "TR_CRCY_CD": "USD",
            "CTX_AREA_FK200": "",
            "CTX_AREA_NK200": ""
        }
        
        result = self._request("GET", endpoint, tr_id, params=params)
        positions = result.get("output1", [])
        logger.info(f"잔고 조회 완료: {len(positions)}개")
        
        return positions


if __name__ == "__main__":
    """테스트 코드"""
    from loguru import logger
    
    # 로깅 설정
    logger.add("logs/kis_client_test.log", rotation="1 day")
    
    # 클라이언트 생성
    client = KISAPIClient()
    
    # 급등주 조회 테스트
    print("\n=== 나스닥 급등주 조회 ===")
    surge_list = client.get_price_surge(
        exchange="NAS",
        direction="1",
        timeframe="3",  # 5분전 대비
        volume_filter="3"  # 1만주 이상
    )
    
    for stock in surge_list[:10]:  # 상위 10개만 출력
        print(f"{stock.get('symb')}: {stock.get('prdy_vrss_sign')} {stock.get('prdy_vrss')}%")

