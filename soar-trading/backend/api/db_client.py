"""
MySQL 데이터베이스 클라이언트
뉴스 데이터 조회 및 분석
"""

import pymysql
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
from loguru import logger
from config import config


class DatabaseClient:
    """MySQL 데이터베이스 클라이언트"""
    
    def __init__(self):
        self.host = config.db.host
        self.user = config.db.user
        self.password = config.db.password
        self.database = config.db.database
        self.port = config.db.port
        
        self.connection: Optional[pymysql.Connection] = None
        
        logger.info(f"DB Client 초기화: {self.host}:{self.port}/{self.database}")
    
    def connect(self):
        """데이터베이스 연결"""
        try:
            self.connection = pymysql.connect(
                host=self.host,
                user=self.user,
                password=self.password,
                database=self.database,
                port=self.port,
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )
            logger.info("DB 연결 성공")
        except Exception as e:
            logger.error(f"DB 연결 실패: {e}")
            raise
    
    def disconnect(self):
        """데이터베이스 연결 종료"""
        if self.connection:
            self.connection.close()
            logger.info("DB 연결 종료")
    
    def execute_query(self, query: str, params: Optional[tuple] = None) -> List[Dict[str, Any]]:
        """
        SQL 쿼리 실행
        
        Args:
            query: SQL 쿼리
            params: 쿼리 파라미터
        
        Returns:
            쿼리 결과 리스트
        """
        if not self.connection:
            self.connect()
        
        try:
            with self.connection.cursor() as cursor:
                cursor.execute(query, params)
                results = cursor.fetchall()
                return results
        except Exception as e:
            logger.error(f"쿼리 실행 실패: {e}")
            raise
    
    # ========== 뉴스 조회 ==========
    
    def get_recent_news(
        self,
        ticker: str,
        hours: int = 24,
        min_grade: str = "C"
    ) -> List[Dict[str, Any]]:
        """
        특정 종목의 최근 뉴스 조회
        
        Args:
            ticker: 종목 심볼
            hours: 조회 시간 범위 (시간)
            min_grade: 최소 등급 (A, B, C, D, F)
        
        Returns:
            뉴스 리스트
        """
        query = """
        SELECT 
            n_idx, n_title, n_title_kr, n_source, n_link,
            n_summary, n_summary_kr, n_ticker, n_bullish, n_bearish,
            n_grade, n_rationale, n_confidence, n_sent_score,
            n_time_et, n_time_kst, n_bullish_potential, n_immediate_impact
        FROM _NEWS
        WHERE n_ticker = %s
          AND n_time_kst >= DATE_SUB(NOW(), INTERVAL %s HOUR)
          AND n_grade >= %s
          AND n_nasdaq_is = 'Y'
        ORDER BY n_time_kst DESC
        LIMIT 50
        """
        
        params = (ticker, hours, min_grade)
        results = self.execute_query(query, params)
        
        logger.info(f"{ticker} 뉴스 조회 완료: {len(results)}개")
        return results
    
    def get_all_recent_news(
        self,
        hours: int = 6,
        min_grade: str = "B"
    ) -> List[Dict[str, Any]]:
        """
        전체 최근 뉴스 조회 (등급 필터)
        
        Args:
            hours: 조회 시간 범위 (시간)
            min_grade: 최소 등급
        
        Returns:
            뉴스 리스트
        """
        query = """
        SELECT 
            n_idx, n_title, n_title_kr, n_source, n_link,
            n_summary, n_summary_kr, n_ticker, n_bullish, n_bearish,
            n_grade, n_rationale, n_confidence, n_sent_score,
            n_time_et, n_time_kst, n_bullish_potential, n_immediate_impact
        FROM _NEWS
        WHERE n_time_kst >= DATE_SUB(NOW(), INTERVAL %s HOUR)
          AND n_grade >= %s
          AND n_nasdaq_is = 'Y'
          AND n_ticker != ''
        ORDER BY n_time_kst DESC
        LIMIT 500
        """
        
        params = (hours, min_grade)
        results = self.execute_query(query, params)
        
        logger.info(f"전체 뉴스 조회 완료: {len(results)}개")
        return results
    
    def get_top_bullish_news(
        self,
        hours: int = 12,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        상승 확률 높은 뉴스 조회
        
        Args:
            hours: 조회 시간 범위 (시간)
            limit: 결과 개수
        
        Returns:
            상승 확률 높은 뉴스 리스트
        """
        query = """
        SELECT 
            n_idx, n_title, n_title_kr, n_ticker, n_bullish, n_bearish,
            n_grade, n_confidence, n_sent_score, n_time_kst,
            n_bullish_potential, n_immediate_impact
        FROM _NEWS
        WHERE n_time_kst >= DATE_SUB(NOW(), INTERVAL %s HOUR)
          AND n_nasdaq_is = 'Y'
          AND n_ticker != ''
          AND n_bullish >= 60
        ORDER BY n_bullish DESC, n_confidence DESC
        LIMIT %s
        """
        
        params = (hours, limit)
        results = self.execute_query(query, params)
        
        logger.info(f"상승 확률 높은 뉴스 조회 완료: {len(results)}개")
        return results
    
    # ========== 뉴스 통계 ==========
    
    def get_news_count_by_ticker(
        self,
        hours: int = 24
    ) -> Dict[str, int]:
        """
        종목별 뉴스 개수
        
        Args:
            hours: 조회 시간 범위 (시간)
        
        Returns:
            종목별 뉴스 개수 딕셔너리
        """
        query = """
        SELECT n_ticker, COUNT(*) as news_count
        FROM _NEWS
        WHERE n_time_kst >= DATE_SUB(NOW(), INTERVAL %s HOUR)
          AND n_nasdaq_is = 'Y'
          AND n_ticker != ''
        GROUP BY n_ticker
        ORDER BY news_count DESC
        """
        
        params = (hours,)
        results = self.execute_query(query, params)
        
        return {row['n_ticker']: row['news_count'] for row in results}
    
    def get_average_sentiment_by_ticker(
        self,
        ticker: str,
        hours: int = 24
    ) -> Optional[float]:
        """
        종목의 평균 감성 점수
        
        Args:
            ticker: 종목 심볼
            hours: 조회 시간 범위 (시간)
        
        Returns:
            평균 감성 점수
        """
        query = """
        SELECT AVG(n_sent_score) as avg_sentiment
        FROM _NEWS
        WHERE n_ticker = %s
          AND n_time_kst >= DATE_SUB(NOW(), INTERVAL %s HOUR)
          AND n_nasdaq_is = 'Y'
        """
        
        params = (ticker, hours)
        results = self.execute_query(query, params)
        
        if results and results[0]['avg_sentiment'] is not None:
            return float(results[0]['avg_sentiment'])
        return None


if __name__ == "__main__":
    """테스트 코드"""
    from loguru import logger
    
    # 로깅 설정
    logger.add("logs/db_client_test.log", rotation="1 day")
    
    # 클라이언트 생성
    client = DatabaseClient()
    client.connect()
    
    try:
        # 최근 상승 뉴스 조회
        print("\n=== 상승 확률 높은 뉴스 ===")
        news_list = client.get_top_bullish_news(hours=12, limit=10)
        
        for news in news_list:
            print(f"\n{news['n_ticker']}: {news['n_title_kr']}")
            print(f"  상승: {news['n_bullish']}% / 하락: {news['n_bearish']}%")
            print(f"  등급: {news['n_grade']} / 신뢰도: {news['n_confidence']}")
            print(f"  시간: {news['n_time_kst']}")
        
        # 종목별 뉴스 개수
        print("\n=== 종목별 뉴스 개수 (Top 10) ===")
        news_counts = client.get_news_count_by_ticker(hours=24)
        
        for ticker, count in list(news_counts.items())[:10]:
            print(f"{ticker}: {count}개")
        
        # 특정 종목 뉴스
        ticker = "AAPL"
        print(f"\n=== {ticker} 최근 뉴스 ===")
        ticker_news = client.get_recent_news(ticker, hours=48)
        
        for news in ticker_news[:5]:
            print(f"\n{news['n_title_kr']}")
            print(f"  상승: {news['n_bullish']}% / 등급: {news['n_grade']}")
        
        # 평균 감성 점수
        avg_sentiment = client.get_average_sentiment_by_ticker(ticker, hours=24)
        print(f"\n{ticker} 평균 감성 점수 (24시간): {avg_sentiment}")
    
    finally:
        client.disconnect()

