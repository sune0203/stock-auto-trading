# utils/fmp_api.py
"""
FMP (Financial Modeling Prep) API 호출 유틸리티
최신 /stable/ 엔드포인트 사용
"""
import os
import requests
from dotenv import load_dotenv
from typing import Dict, List, Any

# .env 로드
load_dotenv()

FMP_KEY = os.getenv("FMP_API_KEY")
BASE = "https://financialmodelingprep.com/stable"

def _get(path: str, params: Dict[str, Any] | None = None) -> Any:
    """
    FMP API GET 요청 공통 함수
    """
    if FMP_KEY is None:
        raise RuntimeError("FMP_API_KEY가 .env 파일에 설정되지 않았습니다")
    
    params = params or {}
    
    # 파라미터를 URL 쿼리 스트링으로 변환
    query_parts = []
    for k, v in params.items():
        query_parts.append(f"{k}={v}")
    query_parts.append(f"apikey={FMP_KEY}")
    query_string = "&".join(query_parts)
    
    url = f"{BASE}{path}?{query_string}"
    
    try:
        r = requests.get(url, timeout=15)
        # 에러 상태일 때만 로그 출력
        if r.status_code != 200:
            print(f"[API ERROR] {path} - Status: {r.status_code}")
        r.raise_for_status()
        return r.json()
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] FMP API 호출 실패: {url}")
        print(f"[ERROR] {e}")
        return None

def get_profile(symbol: str) -> List[Dict] | None:
    """
    종목 프로필 조회 (시가총액, 가격 등)
    새 API: /stable/quote?symbol=AAPL (profile API 대체)
    
    응답 형식:
    [
        {
            "symbol": "AAPL",
            "name": "Apple Inc.",
            "price": 232.8,
            "marketCap": 3500823120000,  // <- marketCap (mktCap 아님!)
            "exchange": "NASDAQ",
            ...
        }
    ]
    """
    return _get("/quote", {"symbol": symbol})

def get_quote(symbol: str) -> List[Dict] | None:
    """
    종목 현재가 조회
    새 API: /stable/quote?symbol=AAPL
    """
    return _get("/quote", {"symbol": symbol})

def get_batch_quotes(symbols: List[str]) -> List[Dict] | None:
    """
    여러 종목 현재가 일괄 조회 (정규장용 배치 API)
    새 API: /stable/batch-quote?symbols=AAPL,MSFT,GOOGL
    
    symbols: 종목 리스트 (최대 50개 권장)
    
    반환 형식:
    [
        {
            "symbol": "AAPL",
            "name": "Apple Inc.",
            "price": 270.14,
            "changePercentage": 0.037,
            "change": 0.1,
            "volume": 40361476,
            "marketCap": 3991696696000,
            ...
        },
        ...
    ]
    """
    if not symbols:
        return []
    
    # 심볼을 쉼표로 연결
    symbols_str = ",".join(symbols[:50])  # 최대 50개씩
    return _get("/batch-quote", {"symbols": symbols_str})

def get_batch_aftermarket_quotes(symbols: List[str]) -> List[Dict] | None:
    """
    여러 종목 애프터마켓/프리마켓 현재가 일괄 조회
    새 API: /stable/batch-aftermarket-trade?symbols=AAPL,MSFT,GOOGL
    
    symbols: 종목 리스트 (최대 50개 권장)
    
    반환 형식:
    [
        {
            "symbol": "AAPL",
            "price": 269.83,
            "tradeSize": null,
            "timestamp": 1762390796000
        },
        ...
    ]
    """
    if not symbols:
        return []
    
    # 심볼을 쉼표로 연결
    symbols_str = ",".join(symbols[:50])  # 최대 50개씩
    return _get("/batch-aftermarket-trade", {"symbols": symbols_str})

def get_hist_daily(symbol: str, days: int = 400) -> Dict | None:
    """
    일봉 히스토리 조회
    새 API: /stable/historical-price-eod/full?symbol=AAPL
    
    반환 형식:
    {
        "symbol": "AAPL",
        "historical": [
            {
                "date": "2025-02-04",
                "open": 227.2,
                "high": 233.13,
                "low": 226.65,
                "close": 232.8,
                "volume": 44489128,
                "change": 5.6,
                "changePercent": 2.46479,
                "vwap": 230.86
            }
        ]
    }
    """
    result = _get("/historical-price-eod/full", {"symbol": symbol})
    
    # 결과가 리스트 형식이면 {"symbol": symbol, "historical": result} 형태로 변환
    if result and isinstance(result, list):
        return {
            "symbol": symbol,
            "historical": result[:days] if days else result
        }
    return result

def get_hist_1min(symbol: str, minutes: int = 390*5) -> List[Dict] | None:
    """
    1분봉 히스토리 조회
    새 API: /stable/historical-chart/1min?symbol=AAPL
    
    정규장(RTH) 기준 최근 minutes 분 데이터
    
    반환 형식:
    [
        {
            "date": "2025-02-04 15:59:00",
            "open": 233.01,
            "low": 232.72,
            "high": 233.13,
            "close": 232.79,
            "volume": 720121
        }
    ]
    """
    result = _get("/historical-chart/1min", {"symbol": symbol})
    
    # minutes 제한 적용
    if result and isinstance(result, list) and minutes:
        return result[:minutes]
    return result

def get_hist_5min(symbol: str, bars: int = 2000) -> List[Dict] | None:
    """
    5분봉 히스토리 조회
    새 API: /stable/historical-chart/5min?symbol=AAPL
    
    bars: 반환할 최대 봉 수
    """
    result = _get("/historical-chart/5min", {"symbol": symbol})
    
    if result and isinstance(result, list) and bars:
        return result[:bars]
    return result

def get_hist_15min(symbol: str, bars: int = 2000) -> List[Dict] | None:
    """
    15분봉 히스토리 조회
    새 API: /stable/historical-chart/15min?symbol=AAPL
    
    bars: 반환할 최대 봉 수
    """
    result = _get("/historical-chart/15min", {"symbol": symbol})
    
    if result and isinstance(result, list) and bars:
        return result[:bars]
    return result

if __name__ == "__main__":
    # 테스트
    print("=== FMP API 테스트 ===")
    
    # 프로필 조회 테스트
    profile = get_profile("AAPL")
    if profile:
        print(f"\nAAPL 프로필: {profile[0].get('name', 'N/A')}")
        print(f"시가총액: ${profile[0].get('marketCap', 0):,}")
    
    # 현재가 조회 테스트
    quote = get_quote("AAPL")
    if quote:
        print(f"\nAAPL 현재가: ${quote[0].get('price', 0)}")
    
    print("\n테스트 완료")

