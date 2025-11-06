"""
뉴스 분석 모듈
DB에서 뉴스 데이터를 가져와 점수화
"""

import math
from typing import Optional, Dict, List
from datetime import datetime
from loguru import logger
from api.db_client import DatabaseClient


class NewsAnalyzer:
    """뉴스 기반 호재/악재 분석"""
    
    def __init__(self, db_client: Optional[DatabaseClient] = None):
        self.db_client = db_client or DatabaseClient()
        if not self.db_client.connection:
            self.db_client.connect()
        
        logger.info("뉴스 분석 모듈 초기화")
    
    def calculate_news_score(
        self,
        ticker: str,
        hours: int = 24
    ) -> Dict[str, any]:
        """
        종목의 뉴스 점수 계산 (0-100)
        
        Args:
            ticker: 종목 심볼
            hours: 조회 시간 범위 (시간)
        
        Returns:
            뉴스 점수 정보
        """
        # 최근 뉴스 조회
        news_list = self.db_client.get_recent_news(ticker, hours=hours, min_grade="C")
        
        if not news_list:
            logger.info(f"{ticker}: 최근 {hours}시간 내 뉴스 없음")
            return {
                "score": 0,
                "news_count": 0,
                "avg_bullish": 0,
                "avg_bearish": 0,
                "avg_confidence": 0,
                "avg_sentiment": 0,
                "weighted_score": 0,
                "has_recent_news": False
            }
        
        # 뉴스 점수 계산
        total_score = 0
        total_weight = 0
        
        total_bullish = 0
        total_bearish = 0
        total_confidence = 0
        total_sentiment = 0
        
        for news in news_list:
            # 시간 가중치 (최근 뉴스일수록 높은 가중치)
            time_weight = self._calculate_time_weight(news['n_time_kst'], hours)
            
            # 기본 점수 계산 (Decimal을 float로 변환)
            bullish = float(news.get('n_bullish', 50))
            bearish = float(news.get('n_bearish', 50))
            confidence = float(news.get('n_confidence', 0.5))
            sent_score = float(news.get('n_sent_score', 0))
            
            # 등급 가중치
            grade_weight = self._get_grade_weight(news.get('n_grade', 'C'))
            
            # 뉴스 점수 = (상승확률 * 0.4 + (100-하락확률) * 0.3 + 신뢰도*100 * 0.2 + (감성점수+1)*50 * 0.1)
            news_score = (
                bullish * 0.4 +
                (100 - bearish) * 0.3 +
                confidence * 100 * 0.2 +
                (sent_score + 1) * 50 * 0.1
            )
            
            # 가중치 적용
            weighted_score = news_score * time_weight * grade_weight
            
            total_score += weighted_score
            total_weight += time_weight * grade_weight
            
            total_bullish += bullish
            total_bearish += bearish
            total_confidence += confidence
            total_sentiment += sent_score
        
        # 평균 계산
        news_count = len(news_list)
        avg_bullish = total_bullish / news_count
        avg_bearish = total_bearish / news_count
        avg_confidence = total_confidence / news_count
        avg_sentiment = total_sentiment / news_count
        
        # 최종 점수 (0-100 스케일)
        final_score = (total_score / total_weight) if total_weight > 0 else 0
        
        # 25점 스케일로 변환
        score_25 = final_score * 0.25
        
        logger.info(f"{ticker} 뉴스 점수: {score_25:.2f}/25 (뉴스 {news_count}개)")
        
        return {
            "score": round(score_25, 2),  # 25점 만점
            "news_count": news_count,
            "avg_bullish": round(avg_bullish, 2),
            "avg_bearish": round(avg_bearish, 2),
            "avg_confidence": round(avg_confidence, 2),
            "avg_sentiment": round(avg_sentiment, 2),
            "weighted_score": round(final_score, 2),  # 100점 만점 (참고용)
            "has_recent_news": True
        }
    
    def _calculate_time_weight(self, news_time: datetime, max_hours: int) -> float:
        """
        뉴스 시간 가중치 계산 (지수 감쇠)
        
        Args:
            news_time: 뉴스 시간
            max_hours: 최대 조회 시간
        
        Returns:
            시간 가중치 (0-1)
        """
        now = datetime.now()
        
        # datetime이 문자열인 경우 변환
        if isinstance(news_time, str):
            news_time = datetime.strptime(news_time, "%Y-%m-%d %H:%M:%S")
        
        hours_ago = (now - news_time).total_seconds() / 3600
        
        # 지수 감쇠 (반감기 12시간)
        half_life = 12
        weight = math.exp(-hours_ago * math.log(2) / half_life)
        
        return weight
    
    def _get_grade_weight(self, grade: str) -> float:
        """
        뉴스 등급 가중치
        
        Args:
            grade: 뉴스 등급 (A, B, C, D, F)
        
        Returns:
            등급 가중치
        """
        grade_weights = {
            "A": 1.5,
            "B": 1.2,
            "C": 1.0,
            "D": 0.7,
            "F": 0.5
        }
        return grade_weights.get(grade, 1.0)
    
    def get_trending_tickers(
        self,
        hours: int = 6,
        min_news_count: int = 2
    ) -> List[Dict[str, any]]:
        """
        뉴스가 많이 나온 종목 찾기
        
        Args:
            hours: 조회 시간 범위
            min_news_count: 최소 뉴스 개수
        
        Returns:
            트렌딩 종목 리스트
        """
        news_counts = self.db_client.get_news_count_by_ticker(hours=hours)
        
        trending = []
        for ticker, count in news_counts.items():
            if count >= min_news_count:
                # 뉴스 점수 계산
                news_info = self.calculate_news_score(ticker, hours=hours)
                
                trending.append({
                    "ticker": ticker,
                    "news_count": count,
                    "news_score": news_info["score"],
                    "avg_bullish": news_info["avg_bullish"],
                    "avg_confidence": news_info["avg_confidence"]
                })
        
        # 뉴스 점수 순으로 정렬
        trending.sort(key=lambda x: x["news_score"], reverse=True)
        
        logger.info(f"트렌딩 종목 {len(trending)}개 발견")
        return trending
    
    def get_catalyst_score(self, ticker: str, hours: int = 24) -> float:
        """
        즉각적인 호재 점수 (immediate impact 기반)
        
        Args:
            ticker: 종목 심볼
            hours: 조회 시간 범위
        
        Returns:
            호재 점수 (0-10)
        """
        news_list = self.db_client.get_recent_news(ticker, hours=hours)
        
        if not news_list:
            return 0.0
        
        max_immediate_impact = 0
        
        for news in news_list:
            immediate_impact = news.get('n_immediate_impact', 0)
            time_weight = self._calculate_time_weight(news['n_time_kst'], hours)
            
            # 최근 뉴스의 즉각 영향도
            weighted_impact = immediate_impact * time_weight
            max_immediate_impact = max(max_immediate_impact, weighted_impact)
        
        # 0-10 스케일
        catalyst_score = min(max_immediate_impact / 10, 10.0)
        
        return round(catalyst_score, 2)


if __name__ == "__main__":
    """테스트 코드"""
    from loguru import logger
    
    # 로깅 설정
    logger.add("logs/news_analyzer_test.log", rotation="1 day")
    
    # 분석기 생성
    analyzer = NewsAnalyzer()
    
    try:
        # 특정 종목 뉴스 점수
        print("\n=== AAPL 뉴스 분석 ===")
        aapl_news = analyzer.calculate_news_score("AAPL", hours=24)
        print(f"점수: {aapl_news['score']}/25")
        print(f"뉴스 개수: {aapl_news['news_count']}")
        print(f"평균 상승확률: {aapl_news['avg_bullish']}%")
        print(f"평균 신뢰도: {aapl_news['avg_confidence']}")
        print(f"평균 감성: {aapl_news['avg_sentiment']}")
        
        # 트렌딩 종목
        print("\n=== 트렌딩 종목 (Top 10) ===")
        trending = analyzer.get_trending_tickers(hours=6, min_news_count=2)
        
        for item in trending[:10]:
            print(f"\n{item['ticker']}")
            print(f"  뉴스 개수: {item['news_count']}")
            print(f"  뉴스 점수: {item['news_score']}/25")
            print(f"  평균 상승확률: {item['avg_bullish']}%")
        
        # 호재 점수
        print("\n=== 종목별 호재 점수 ===")
        test_tickers = ["NVDA", "TSLA", "MSFT"]
        for ticker in test_tickers:
            catalyst = analyzer.get_catalyst_score(ticker, hours=12)
            print(f"{ticker}: {catalyst}/10")
    
    finally:
        analyzer.db_client.disconnect()

