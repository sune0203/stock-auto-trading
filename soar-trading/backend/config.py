"""
설정 파일
환경 변수를 로드하고 전역 설정을 관리합니다.
"""

import os
from typing import Optional
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# .env 파일 로드
load_dotenv()


class KISConfig(BaseSettings):
    """한국투자증권 API 설정"""
    app_key: str = os.getenv("KIS_APP_KEY", "")
    app_secret: str = os.getenv("KIS_APP_SECRET", "")
    account_no: str = os.getenv("KIS_ACCOUNT_NO", "")
    use_mock: bool = os.getenv("KIS_USE_MOCK", "true").lower() == "true"
    base_url: str = os.getenv("KIS_BASE_URL", "https://openapi.koreainvestment.com:9443")
    
    def validate(self) -> bool:
        """필수 설정 값 검증"""
        if not self.app_key or not self.app_secret or not self.account_no:
            return False
        return True


class FMPConfig(BaseSettings):
    """Financial Modeling Prep API 설정"""
    api_key: str = os.getenv("FMP_API_KEY", "")
    base_url: str = os.getenv("FMP_BASE_URL", "https://financialmodelingprep.com/stable")
    requests_per_minute: int = int(os.getenv("FMP_REQUESTS_PER_MINUTE", "3000"))
    
    def validate(self) -> bool:
        """필수 설정 값 검증"""
        return bool(self.api_key)


class DatabaseConfig(BaseSettings):
    """MySQL 데이터베이스 설정"""
    host: str = os.getenv("DB_HOST", "116.122.37.82")
    user: str = os.getenv("DB_USER", "nasdaq")
    password: str = os.getenv("DB_PASS", "")
    database: str = os.getenv("DB_NAME", "nasdaq")
    port: int = int(os.getenv("DB_PORT", "3306"))
    
    def get_connection_string(self) -> str:
        """SQLAlchemy 연결 문자열 생성"""
        return f"mysql+pymysql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"


class TradingConfig(BaseSettings):
    """거래 설정"""
    # 포지션 관리
    max_position_size: float = float(os.getenv("MAX_POSITION_SIZE", "0.10"))
    max_daily_loss: float = float(os.getenv("MAX_DAILY_LOSS", "0.05"))
    max_concurrent_trades: int = int(os.getenv("MAX_CONCURRENT_TRADES", "5"))
    
    # 진입 조건
    min_score: int = int(os.getenv("MIN_SCORE", "70"))
    min_daily_volume: int = int(os.getenv("MIN_DAILY_VOLUME", "500000"))
    min_dollar_volume: int = int(os.getenv("MIN_DOLLAR_VOLUME", "10000000"))
    
    # 리스크 관리
    fixed_stop_loss_percent: float = float(os.getenv("FIXED_STOP_LOSS_PERCENT", "2.0"))
    trailing_stop_percent: float = float(os.getenv("TRAILING_STOP_PERCENT", "0.70"))
    max_slippage_percent: float = float(os.getenv("MAX_SLIPPAGE_PERCENT", "0.5"))


class MarketHoursConfig(BaseSettings):
    """시장 시간 설정 (ET - Eastern Time)"""
    pre_market_start: str = os.getenv("PRE_MARKET_START", "04:00")
    market_open: str = os.getenv("MARKET_OPEN", "09:30")
    market_close: str = os.getenv("MARKET_CLOSE", "16:00")
    after_market_end: str = os.getenv("AFTER_MARKET_END", "20:00")


class ScannerConfig(BaseSettings):
    """스캐너 설정"""
    scan_interval: int = int(os.getenv("SCAN_INTERVAL", "60"))  # 스캔 주기 (초)
    max_scan_symbols: int = int(os.getenv("MAX_SCAN_SYMBOLS", "100"))  # 최대 스캔 종목 수
    surge_min_volume_multiple: float = float(os.getenv("SURGE_MIN_VOLUME_MULTIPLE", "3.0"))  # 거래량 급증 최소 배수


class APIRateLimitConfig(BaseSettings):
    """API 요청 제한 설정"""
    fmp_requests_per_minute: int = int(os.getenv("FMP_REQUESTS_PER_MINUTE", "3000"))
    kis_requests_per_second: int = int(os.getenv("KIS_REQUESTS_PER_SECOND", "20"))


class ServerConfig(BaseSettings):
    """서버 설정"""
    host: str = os.getenv("API_HOST", "0.0.0.0")
    port: int = int(os.getenv("API_PORT", "8000"))
    debug: bool = os.getenv("DEBUG", "true").lower() == "true"


class LoggingConfig(BaseSettings):
    """로깅 설정"""
    level: str = os.getenv("LOG_LEVEL", "INFO")
    file: str = os.getenv("LOG_FILE", "logs/soar_trading.log")


class Config:
    """전역 설정 클래스"""
    
    def __init__(self):
        self.kis = KISConfig()
        self.fmp = FMPConfig()
        self.db = DatabaseConfig()
        self.trading = TradingConfig()
        self.market_hours = MarketHoursConfig()
        self.scanner = ScannerConfig()
        self.rate_limit = APIRateLimitConfig()
        self.server = ServerConfig()
        self.logging = LoggingConfig()
    
    def validate_all(self) -> tuple[bool, list[str]]:
        """
        모든 설정 검증
        
        Returns:
            (is_valid, errors): 검증 결과와 에러 메시지 리스트
        """
        errors = []
        
        if not self.kis.validate():
            errors.append("KIS API 설정이 올바르지 않습니다. (APP_KEY, APP_SECRET, ACCOUNT_NO 확인)")
        
        if not self.fmp.validate():
            errors.append("FMP API 설정이 올바르지 않습니다. (API_KEY 확인)")
        
        if not self.db.password:
            errors.append("DB 비밀번호가 설정되지 않았습니다.")
        
        return (len(errors) == 0, errors)
    
    def print_config(self):
        """설정 정보 출력 (민감 정보 마스킹)"""
        print("=" * 60)
        print("SOAR Trading System Configuration")
        print("=" * 60)
        
        print("\n[KIS API]")
        print(f"  Base URL: {self.kis.base_url}")
        print(f"  Account: {self._mask_string(self.kis.account_no)}")
        print(f"  Mock Mode: {self.kis.use_mock}")
        
        print("\n[FMP API]")
        print(f"  Base URL: {self.fmp.base_url}")
        print(f"  API Key: {self._mask_string(self.fmp.api_key)}")
        print(f"  Rate Limit: {self.fmp.requests_per_minute} req/min")
        
        print("\n[Database]")
        print(f"  Host: {self.db.host}:{self.db.port}")
        print(f"  Database: {self.db.database}")
        print(f"  User: {self.db.user}")
        
        print("\n[Trading]")
        print(f"  Max Position Size: {self.trading.max_position_size * 100}%")
        print(f"  Max Daily Loss: {self.trading.max_daily_loss * 100}%")
        print(f"  Max Concurrent Trades: {self.trading.max_concurrent_trades}")
        print(f"  Min Entry Score: {self.trading.min_score}")
        print(f"  Stop Loss: {self.trading.fixed_stop_loss_percent}%")
        
        print("\n[Scanner]")
        print(f"  Scan Interval: {self.scanner.scan_interval}s")
        print(f"  Max Symbols: {self.scanner.max_scan_symbols}")
        
        print("\n[Server]")
        print(f"  Host: {self.server.host}:{self.server.port}")
        print(f"  Debug: {self.server.debug}")
        
        print("=" * 60)
    
    @staticmethod
    def _mask_string(s: str, show_chars: int = 4) -> str:
        """문자열 마스킹 (뒤 4자리만 표시)"""
        if not s or len(s) <= show_chars:
            return "***"
        return "*" * (len(s) - show_chars) + s[-show_chars:]


# 전역 설정 인스턴스
config = Config()


if __name__ == "__main__":
    # 설정 검증 및 출력
    is_valid, errors = config.validate_all()
    
    if not is_valid:
        print("⚠️  설정 오류:")
        for error in errors:
            print(f"  - {error}")
        print("\nenv_template.txt를 참고하여 .env 파일을 생성하세요.")
    else:
        print("✅ 모든 설정이 올바릅니다.")
        config.print_config()

