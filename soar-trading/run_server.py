"""
SOAR Trading System 서버 실행 스크립트
루트 디렉토리에서 실행하세요
"""

import sys
from pathlib import Path

# backend 디렉토리를 Python 경로에 추가
backend_path = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_path))

# 서버 실행
if __name__ == "__main__":
    import uvicorn
    from loguru import logger
    
    # 로깅 설정
    logger.add("backend/logs/server_{time}.log", rotation="1 day", retention="7 days")
    
    # 설정 로드 및 검증
    from config import config
    
    is_valid, errors = config.validate_all()
    
    if not is_valid:
        logger.error("⚠️  설정 오류:")
        for error in errors:
            logger.error(f"  - {error}")
        print("\n❌ 설정 오류가 있습니다. env_template.txt를 참고하여 .env 파일을 생성하세요.\n")
        sys.exit(1)
    
    print("\n" + "="*60)
    print("🚀 SOAR Trading System 서버 시작")
    print("="*60)
    config.print_config()
    
    print(f"\n✅ API 서버: http://localhost:{config.server.port}")
    print(f"✅ API 문서: http://localhost:{config.server.port}/docs")
    print(f"✅ 웹 대시보드: frontend/index.html 파일을 브라우저에서 열어주세요")
    print("\n⚠️  중단하려면 Ctrl+C를 누르세요\n")
    
    # uvicorn 서버 실행
    uvicorn.run(
        "server:app",
        host=config.server.host,
        port=config.server.port,
        reload=config.server.debug,
        log_level="info",
        app_dir=str(backend_path)
    )

