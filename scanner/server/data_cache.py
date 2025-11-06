# server/data_cache.py
"""
15분봉 데이터 캐싱 시스템
API 호출을 최소화하여 성능 향상
"""
import time
from typing import Dict, List, Optional
from datetime import datetime, timedelta

class HistoricalDataCache:
    """
    15분봉 히스토리컬 데이터 캐시
    """
    
    def __init__(self, cache_ttl_seconds: int = 900):
        """
        Args:
            cache_ttl_seconds: 캐시 유효 시간 (기본 900초 = 15분)
        """
        self.cache: Dict[str, Dict] = {}
        self.cache_ttl = cache_ttl_seconds
    
    def get(self, symbol: str) -> Optional[List[Dict]]:
        """
        캐시에서 데이터 조회
        
        Args:
            symbol: 종목 심볼
        
        Returns:
            15분봉 데이터 (없거나 만료되면 None)
        """
        if symbol not in self.cache:
            return None
        
        entry = self.cache[symbol]
        
        # 캐시 만료 체크
        elapsed = time.time() - entry["timestamp"]
        if elapsed > self.cache_ttl:
            # 만료된 캐시 삭제
            del self.cache[symbol]
            return None
        
        return entry["data"]
    
    def set(self, symbol: str, data: List[Dict]):
        """
        캐시에 데이터 저장
        
        Args:
            symbol: 종목 심볼
            data: 15분봉 데이터
        """
        self.cache[symbol] = {
            "data": data,
            "timestamp": time.time()
        }
    
    def clear(self):
        """
        전체 캐시 삭제
        """
        self.cache.clear()
    
    def get_stats(self) -> Dict:
        """
        캐시 통계 반환
        """
        now = time.time()
        valid_count = sum(
            1 for entry in self.cache.values()
            if (now - entry["timestamp"]) <= self.cache_ttl
        )
        
        return {
            "total": len(self.cache),
            "valid": valid_count,
            "expired": len(self.cache) - valid_count
        }

# 전역 캐시 인스턴스
HIST_CACHE = HistoricalDataCache(cache_ttl_seconds=900)  # 15분

if __name__ == "__main__":
    # 테스트
    cache = HistoricalDataCache(cache_ttl_seconds=60)
    
    # 데이터 저장
    test_data = [{"date": "2025-01-01", "close": 100}]
    cache.set("AAPL", test_data)
    
    # 데이터 조회
    result = cache.get("AAPL")
    print(f"캐시 조회: {result}")
    
    # 통계
    stats = cache.get_stats()
    print(f"캐시 통계: {stats}")
    
    # 만료 후 조회
    import time
    time.sleep(61)
    result = cache.get("AAPL")
    print(f"만료 후 조회: {result}")

