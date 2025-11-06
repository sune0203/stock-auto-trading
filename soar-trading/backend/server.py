"""
SOAR Trading System - FastAPI 서버
실시간 스캔 결과 및 거래 API 제공
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from typing import Optional, List, AsyncGenerator
import uvicorn
from loguru import logger
import sys
import asyncio
import json
from pathlib import Path
import pandas as pd

# 현재 디렉토리를 Python 경로에 추가
sys.path.insert(0, str(Path(__file__).parent))

from config import config
from scanner.surge_scanner import SurgeScanner, get_session_info
from analyzer.scoring import ScoreEngine
from api.kis_client import KISAPIClient
from api.fmp_client import FMPAPIClient
from api.db_client import DatabaseClient
from monitor.realtime_monitor import RealtimeMonitor

# FastAPI 앱 생성
app = FastAPI(
    title="SOAR Trading System API",
    description="Smart Opportunity Analysis & Rapid Trading System",
    version="1.0.0"
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 실제 운영 시에는 특정 도메인만 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 전역 객체
scanner: Optional[SurgeScanner] = None
score_engine: Optional[ScoreEngine] = None
kis_client: Optional[KISAPIClient] = None
fmp_client: Optional[FMPAPIClient] = None
db_client: Optional[DatabaseClient] = None
realtime_monitor: Optional[RealtimeMonitor] = None

# 실시간 스캔 결과 큐 (SSE용)
scan_progress_queue: asyncio.Queue = asyncio.Queue()
realtime_update_queue: asyncio.Queue = asyncio.Queue()

# 자동 스캔 설정
AUTO_SCAN_INTERVAL = 60  # 1분마다 자동 스캔
auto_scan_task: Optional[asyncio.Task] = None
price_update_task: Optional[asyncio.Task] = None

# 스캔 결과 캐시 (심볼별 최신 분석 결과)
scan_results_cache: dict = {}


@app.on_event("startup")
async def startup_event():
    """서버 시작 시 초기화"""
    global scanner, score_engine, kis_client, fmp_client, db_client, realtime_monitor, auto_scan_task, price_update_task
    
    logger.info("SOAR Trading System 서버 시작...")
    
    # 설정 검증
    is_valid, errors = config.validate_all()
    if not is_valid:
        logger.error("설정 오류:")
        for error in errors:
            logger.error(f"  - {error}")
        raise Exception("설정 오류")
    
    config.print_config()
    
    # 클라이언트 초기화
    kis_client = KISAPIClient()
    fmp_client = FMPAPIClient()
    db_client = DatabaseClient()
    db_client.connect()
    
    # 분석 엔진 초기화
    score_engine = ScoreEngine()
    
    # 스캐너 초기화
    scanner = SurgeScanner(
        kis_client=kis_client,
        fmp_client=fmp_client,
        score_engine=score_engine
    )
    
    # 실시간 모니터 초기화 및 시작
    realtime_monitor = RealtimeMonitor(fmp_client=fmp_client, score_engine=score_engine)
    realtime_monitor.start()
    
    # 자동 스캔 백그라운드 태스크 시작
    auto_scan_task = asyncio.create_task(_auto_scan_loop())
    
    # 가격 업데이트 백그라운드 태스크 시작
    price_update_task = asyncio.create_task(_realtime_price_update_loop())
    
    logger.info("✅ 모든 시스템 초기화 완료")
    logger.info(f"🔄 자동 스캔: {AUTO_SCAN_INTERVAL}초마다 실행 (병렬 처리)")
    logger.info(f"📈 가격 업데이트: 5초마다 재평가 (세션별 API 자동 선택)")
    logger.info(f"💰 프론트엔드: 3초마다 독립적 가격 조회")


@app.on_event("shutdown")
async def shutdown_event():
    """서버 종료 시 정리"""
    global auto_scan_task, price_update_task
    
    logger.info("서버 종료 중...")
    
    # 자동 스캔 태스크 취소
    if auto_scan_task:
        auto_scan_task.cancel()
        try:
            await auto_scan_task
        except asyncio.CancelledError:
            pass
    
    # 가격 업데이트 태스크 취소
    if price_update_task:
        price_update_task.cancel()
        try:
            await price_update_task
        except asyncio.CancelledError:
            pass
    
    if scanner:
        scanner.stop_scan()
    
    if realtime_monitor:
        realtime_monitor.stop()
    
    if db_client:
        db_client.disconnect()
    
    logger.info("서버 종료 완료")


# ========== 백그라운드 태스크 ==========

async def _auto_scan_loop():
    """
    자동 스캔 루프 (1분마다 실행)
    - 스캔 실행
    - 결과 캐시에 저장
    - 실시간 업데이트 큐에 푸시
    """
    try:
        logger.info("🔄 자동 스캔 루프 시작")
        
        # 첫 스캔 전 10초 대기 (서버 완전 시작 대기)
        await asyncio.sleep(10)
        
        while True:
            try:
                logger.info(f"\n{'='*60}")
                logger.info(f"🔍 자동 스캔 시작")
                logger.info(f"{'='*60}")
                
                # 스캔 실행 (각 종목 완료 시마다 실시간 전송)
                if scanner:
                    # 콜백 함수: 각 종목 완료 시 즉시 캐시 업데이트 및 전송
                    def on_symbol_completed(result):
                        symbol = result['symbol']
                        
                        # 발견 당시 가격 저장 (최초 스캔 시에만)
                        if symbol not in scan_results_cache:
                            trading_plan = result.get('trading_plan', {})
                            discovered_price = trading_plan.get('current_price', 0)
                            result['discovered_price'] = discovered_price
                            result['discovered_time'] = pd.Timestamp.now().isoformat()
                            logger.debug(f"{symbol} 발견: ${discovered_price:.2f}")
                        else:
                            # 기존 발견 가격 유지
                            result['discovered_price'] = scan_results_cache[symbol].get('discovered_price', 0)
                            result['discovered_time'] = scan_results_cache[symbol].get('discovered_time', '')
                        
                        scan_results_cache[symbol] = result
                        
                        # 즉시 클라이언트로 전송 (단일 종목)
                        asyncio.create_task(realtime_update_queue.put({
                            "type": "symbol_update",
                            "timestamp": pd.Timestamp.now().isoformat(),
                            "symbol": symbol,
                            "data": result
                        }))
                    
                    results = scanner.scan_once_with_callback(
                        exchange="NAS",
                        max_symbols=20,
                        on_result=on_symbol_completed
                    )
                    
                    if results:
                        logger.info(f"✅ 스캔 완료: {len(results)}개 종목")
                        
                        # 실시간 모니터에 추가
                        if realtime_monitor:
                            new_symbols = [r['symbol'] for r in results]
                            realtime_monitor.add_symbols(new_symbols)
                        
                        logger.info(f"📊 캐시된 총 종목 수: {len(scan_results_cache)}개")
                    else:
                        logger.warning("⚠️ 스캔 결과 없음")
                
                # 다음 스캔까지 대기
                logger.info(f"⏰ 다음 스캔까지 {AUTO_SCAN_INTERVAL}초 대기...")
                await asyncio.sleep(AUTO_SCAN_INTERVAL)
            
            except Exception as e:
                logger.error(f"자동 스캔 오류: {e}")
                await asyncio.sleep(AUTO_SCAN_INTERVAL)
    
    except asyncio.CancelledError:
        logger.info("자동 스캔 루프 취소됨")
        raise


async def _realtime_price_update_loop():
    """
    실시간 가격 업데이트 루프 (캐시된 종목 재평가)
    - RealtimeMonitor의 가격 데이터 가져오기
    - 캐시된 종목의 점수 재계산
    - 업데이트 큐에 푸시
    """
    try:
        logger.info("📈 실시간 가격 업데이트 루프 시작")
        
        await asyncio.sleep(15)  # 첫 스캔 후 시작
        
        while True:
            try:
                if not scan_results_cache or not realtime_monitor:
                    await asyncio.sleep(5)
                    continue
                
                # 실시간 모니터에서 최신 가격 데이터 가져오기
                monitor_data = realtime_monitor.get_current_data()
                prices_list = monitor_data.get('prices', [])
                
                if not prices_list:
                    await asyncio.sleep(5)
                    continue
                
                # 세션 정보 로깅
                session = prices_list[0].get('session', 'UNKNOWN') if prices_list else 'UNKNOWN'
                logger.debug(f"가격 재평가 시작 (session={session}, {len(prices_list)}개 종목)")
                
                # 리스트를 딕셔너리로 변환 (symbol을 키로)
                prices = {item['symbol']: item for item in prices_list}
                
                # 캐시된 각 종목 재평가 (개별 전송)
                updated_count = 0
                
                for symbol, cached_result in scan_results_cache.items():
                    if symbol in prices:
                        price_data = prices[symbol]
                        
                        # 현재가 가져오기
                        current_price = price_data.get('price', 0)
                        
                        if current_price > 0:
                            # 발견 당시 가격 (최초 저장된 가격)
                            discovered_price = cached_result.get('discovered_price', current_price)
                            
                            # 발견 이후 변화율 계산
                            if discovered_price > 0:
                                price_change_pct = ((current_price - discovered_price) / discovered_price) * 100
                            else:
                                price_change_pct = 0
                            
                            # 변화 로그 (의미있는 변화가 있을 때만)
                            if abs(price_change_pct) >= 0.5:  # 0.5% 이상 변화 시
                                change_emoji = "📈" if price_change_pct > 0 else "📉"
                                logger.debug(f"{change_emoji} {symbol}: ${discovered_price:.2f} → ${current_price:.2f} ({price_change_pct:+.2f}%)")
                            
                            # 트레이딩 플랜 업데이트 (현재가 기준)
                            if score_engine:
                                updated_plan = score_engine._calculate_trading_plan(
                                    symbol=symbol,
                                    score=cached_result.get('total_score', 0),
                                    vwap_info=cached_result.get('details', {}).get('vwap', {}),
                                    volume_info=cached_result.get('details', {}).get('volume', {}),
                                    momentum_info=cached_result.get('details', {}).get('momentum', {})
                                )
                                cached_result['trading_plan'] = updated_plan
                            
                            # 실시간 가격 정보 업데이트
                            cached_result['realtime_price'] = current_price
                            cached_result['price_change_pct'] = round(price_change_pct, 2)  # 발견 이후 변화율
                            cached_result['last_updated'] = pd.Timestamp.now().isoformat()
                            
                            # 즉시 클라이언트로 전송 (개별 종목)
                            await realtime_update_queue.put({
                                "type": "symbol_update",
                                "timestamp": pd.Timestamp.now().isoformat(),
                                "symbol": symbol,
                                "data": cached_result
                            })
                            
                            updated_count += 1
                
                if updated_count > 0:
                    logger.debug(f"💰 {updated_count}개 종목 가격 재평가 완료 (발견가 대비 변화율 포함)")
                
                # 5초마다 업데이트 (더 빠른 실시간 반영)
                await asyncio.sleep(5)
            
            except Exception as e:
                logger.error(f"가격 업데이트 오류: {e}")
                await asyncio.sleep(10)
    
    except asyncio.CancelledError:
        logger.info("가격 업데이트 루프 취소됨")
        raise


# ========== API 엔드포인트 ==========

@app.get("/")
async def root():
    """루트 엔드포인트"""
    return {
        "name": "SOAR Trading System API",
        "version": "1.0.0",
        "status": "running",
        "market_open": fmp_client.is_market_open() if fmp_client else False
    }


@app.get("/api/health")
async def health_check():
    """헬스 체크"""
    return {
        "status": "healthy",
        "kis_connected": kis_client is not None,
        "fmp_connected": fmp_client is not None,
        "db_connected": db_client is not None and db_client.connection is not None,
        "market_open": fmp_client.is_market_open() if fmp_client else False
    }


@app.get("/api/market/session")
async def market_session():
    """
    현재 시장 세션 정보 조회
    
    Returns:
        - session: RTH(정규장), PRE(프리마켓), AFTER(애프터마켓), CLOSED(장마감)
        - session_name: 세션 이름 (한글)
        - is_trading: 거래 가능 여부
        - is_dst: 서머타임 적용 여부
        - current_time: 현재 시간 (한국 시간)
        - next_open: 다음 장 시작 정보
    """
    try:
        session_info = get_session_info()
        return JSONResponse(content=session_info)
    except Exception as e:
        logger.error(f"시장 세션 정보 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/scan")
async def run_scan(
    exchange: str = "NAS",
    max_symbols: int = 50
):
    """
    급등주 스캔 실행 (백그라운드 실행, SSE로 실시간 진행 상황 전송)
    
    Args:
        exchange: 거래소 (NAS, NYS, AMS)
        max_symbols: 최대 조회 종목 수
    """
    if not scanner:
        raise HTTPException(status_code=503, detail="Scanner not initialized")
    
    # 백그라운드에서 스캔 실행
    asyncio.create_task(_run_scan_background(exchange, max_symbols))
    
    return {
        "status": "scanning",
        "message": "스캔이 시작되었습니다. /api/scan/stream으로 실시간 진행 상황을 확인하세요."
    }


async def _run_scan_background(exchange: str, max_symbols: int):
    """백그라운드에서 스캔 실행 (각 종목 완료 시마다 큐에 추가)"""
    try:
        logger.info(f"백그라운드 스캔 시작: {exchange}, {max_symbols}개")
        
        # 스캔 시작 알림
        await scan_progress_queue.put({
            "type": "scan_started",
            "exchange": exchange,
            "max_symbols": max_symbols
        })
        
        results = scanner.scan_once_with_callback(
            exchange=exchange,
            max_symbols=max_symbols,
            on_result=lambda result: asyncio.create_task(scan_progress_queue.put({
                "type": "symbol_completed",
                "data": result
            }))
        )
        
        # 스캔 완료 알림
        await scan_progress_queue.put({
            "type": "scan_completed",
            "total_count": len(results)
        })
        
        # 실시간 모니터에 추가
        if realtime_monitor and results:
            symbols = [item['symbol'] for item in results]
            realtime_monitor.add_symbols(symbols)
            logger.info(f"{len(symbols)}개 종목 실시간 모니터링 시작")
    
    except Exception as e:
        logger.error(f"백그라운드 스캔 실패: {e}")
        await scan_progress_queue.put({
            "type": "scan_error",
            "error": str(e)
        })


@app.get("/api/scan/stream")
async def scan_stream():
    """
    SSE (Server-Sent Events) 스트리밍 엔드포인트
    스캔 진행 상황을 실시간으로 전송
    """
    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            while True:
                # 큐에서 결과 가져오기 (타임아웃 60초)
                try:
                    event_data = await asyncio.wait_for(scan_progress_queue.get(), timeout=60.0)
                    
                    # SSE 형식으로 전송
                    yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"
                    
                    # 스캔 완료 또는 에러 시 종료
                    if event_data.get("type") in ["scan_completed", "scan_error"]:
                        break
                
                except asyncio.TimeoutError:
                    # 하트비트 전송 (연결 유지)
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
        
        except asyncio.CancelledError:
            logger.info("SSE 스트림 취소됨")
        except Exception as e:
            logger.error(f"SSE 스트림 오류: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.get("/api/scan/results")
async def get_scan_results(
    min_score: Optional[int] = None,
    limit: int = 20
):
    """
    스캔 결과 조회 (캐시된 결과)
    
    Args:
        min_score: 최소 점수 (None이면 모든 결과)
        limit: 결과 개수
    """
    # 캐시에서 결과 가져오기 (점수 순 정렬)
    all_results = sorted(
        scan_results_cache.values(),
        key=lambda x: x.get('total_score', 0),
        reverse=True
    )
    
    if not all_results:
        return {
            "status": "success",
            "count": 0,
            "results": []
        }
    
    # 최소 점수 필터링 (옵션)
    if min_score is not None:
        results = [r for r in all_results if r.get('total_score', 0) >= min_score]
    else:
        results = all_results
    
    # 상위 N개만 반환
    top_results = results[:limit]
    
    return {
        "status": "success",
        "count": len(top_results),
        "results": top_results
    }


@app.get("/api/realtime/stream")
async def realtime_stream():
    """
    실시간 업데이트 SSE 스트리밍 엔드포인트
    - 스캔 결과 업데이트
    - 가격 변동 업데이트
    """
    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            # 첫 연결 시 현재 캐시된 결과 전송
            if scan_results_cache:
                cached_results = sorted(
                    scan_results_cache.values(),
                    key=lambda x: x.get('total_score', 0),
                    reverse=True
                )[:20]
                
                yield f"data: {json.dumps({
                    'type': 'initial_data',
                    'timestamp': pd.Timestamp.now().isoformat(),
                    'count': len(cached_results),
                    'results': cached_results
                }, ensure_ascii=False)}\n\n"
            
            # 실시간 업데이트 스트리밍
            while True:
                try:
                    # 큐에서 업데이트 가져오기 (타임아웃 30초)
                    update_data = await asyncio.wait_for(
                        realtime_update_queue.get(),
                        timeout=30.0
                    )
                    
                    # SSE 형식으로 전송
                    yield f"data: {json.dumps(update_data, ensure_ascii=False)}\n\n"
                
                except asyncio.TimeoutError:
                    # 하트비트 전송 (연결 유지)
                    yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': pd.Timestamp.now().isoformat()})}\n\n"
        
        except asyncio.CancelledError:
            logger.info("실시간 스트림 취소됨")
        except Exception as e:
            logger.error(f"실시간 스트림 오류: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.get("/api/analyze/{symbol}")
async def analyze_symbol(symbol: str):
    """
    특정 종목 분석
    
    Args:
        symbol: 종목 심볼
    """
    if not score_engine:
        raise HTTPException(status_code=503, detail="Score engine not initialized")
    
    try:
        result = score_engine.calculate_score(symbol)
        
        # 목표가 계산
        quote = fmp_client.get_quote(symbol)
        current_price = quote.get('price', 0)
        
        targets = score_engine.calculate_targets(
            symbol,
            current_price,
            result['total_score']
        )
        
        return {
            "status": "success",
            "analysis": result,
            "current_price": current_price,
            "targets": targets
        }
    
    except Exception as e:
        logger.error(f"{symbol} 분석 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/quote/{symbol}")
async def get_quote(symbol: str):
    """
    실시간 시세 조회
    
    Args:
        symbol: 종목 심볼
    """
    if not fmp_client:
        raise HTTPException(status_code=503, detail="FMP client not initialized")
    
    try:
        quote = fmp_client.get_quote(symbol)
        return {
            "status": "success",
            "quote": quote
        }
    
    except Exception as e:
        logger.error(f"{symbol} 시세 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/quotes/batch")
async def get_batch_quotes(symbols: List[str]):
    """
    다중 종목 실시간 시세 조회 (배치)
    
    프론트엔드에서 직접 호출하여 실시간 가격 업데이트
    
    Args:
        symbols: 종목 심볼 리스트 (최대 100개)
    
    Returns:
        시세 정보 리스트
    """
    if not fmp_client:
        raise HTTPException(status_code=503, detail="FMP client not initialized")
    
    try:
        # 시장 세션 확인
        from scanner.surge_scanner import get_market_session
        session = get_market_session()
        
        # 세션에 따라 적절한 API 사용
        if session == "RTH":
            quotes = fmp_client.get_batch_quotes(symbols)
        else:
            quotes = fmp_client.get_batch_aftermarket_quotes(symbols)
        
        return {
            "status": "success",
            "session": session,
            "count": len(quotes),
            "quotes": quotes
        }
    
    except Exception as e:
        logger.error(f"배치 시세 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/news/{symbol}")
async def get_news(
    symbol: str,
    hours: int = 24
):
    """
    종목 뉴스 조회
    
    Args:
        symbol: 종목 심볼
        hours: 조회 시간 범위
    """
    if not db_client:
        raise HTTPException(status_code=503, detail="DB client not initialized")
    
    try:
        news_list = db_client.get_recent_news(symbol, hours=hours)
        
        return {
            "status": "success",
            "count": len(news_list),
            "news": news_list
        }
    
    except Exception as e:
        logger.error(f"{symbol} 뉴스 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/news/trending")
async def get_trending_news(hours: int = 6):
    """
    트렌딩 뉴스 조회
    
    Args:
        hours: 조회 시간 범위
    """
    if not db_client:
        raise HTTPException(status_code=503, detail="DB client not initialized")
    
    try:
        news_list = db_client.get_top_bullish_news(hours=hours, limit=50)
        
        return {
            "status": "success",
            "count": len(news_list),
            "news": news_list
        }
    
    except Exception as e:
        logger.error(f"트렌딩 뉴스 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/config")
async def get_config():
    """시스템 설정 조회"""
    return {
        "trading": {
            "max_position_size": config.trading.max_position_size,
            "max_daily_loss": config.trading.max_daily_loss,
            "max_concurrent_trades": config.trading.max_concurrent_trades,
            "min_score": config.trading.min_score,
            "fixed_stop_loss_percent": config.trading.fixed_stop_loss_percent
        },
        "scanner": {
            "scan_interval": config.scanner.scan_interval,
            "max_scan_symbols": config.scanner.max_scan_symbols
        },
        "market_hours": {
            "market_open": config.market_hours.market_open,
            "market_close": config.market_hours.market_close
        }
    }


# ========== 실시간 모니터링 API ==========

@app.get("/api/monitor/status")
async def get_monitor_status():
    """
    실시간 모니터 상태 조회
    """
    if not realtime_monitor:
        raise HTTPException(status_code=503, detail="Monitor not initialized")
    
    data = realtime_monitor.get_current_data()
    
    return {
        "status": "success",
        "monitor_running": realtime_monitor.is_running,
        **data
    }


@app.get("/api/monitor/prices")
async def get_realtime_prices():
    """
    실시간 가격 조회
    """
    if not realtime_monitor:
        raise HTTPException(status_code=503, detail="Monitor not initialized")
    
    data = realtime_monitor.get_current_data()
    
    return {
        "status": "success",
        **data
    }


@app.get("/api/monitor/symbol/{symbol}")
async def get_symbol_realtime(symbol: str):
    """
    특정 종목 실시간 데이터 조회
    
    Args:
        symbol: 종목 심볼
    """
    if not realtime_monitor:
        raise HTTPException(status_code=503, detail="Monitor not initialized")
    
    data = realtime_monitor.get_symbol_data(symbol)
    
    if not data:
        raise HTTPException(status_code=404, detail=f"{symbol} not found in watchlist")
    
    return {
        "status": "success",
        "data": data
    }


@app.get("/api/monitor/gainers")
async def get_top_gainers(limit: int = 10):
    """
    상승률 상위 종목
    
    Args:
        limit: 반환 개수
    """
    if not realtime_monitor:
        raise HTTPException(status_code=503, detail="Monitor not initialized")
    
    gainers = realtime_monitor.get_top_gainers(limit=limit)
    
    return {
        "status": "success",
        "count": len(gainers),
        "gainers": gainers
    }


@app.get("/api/monitor/losers")
async def get_top_losers(limit: int = 10):
    """
    하락률 상위 종목
    
    Args:
        limit: 반환 개수
    """
    if not realtime_monitor:
        raise HTTPException(status_code=503, detail="Monitor not initialized")
    
    losers = realtime_monitor.get_top_losers(limit=limit)
    
    return {
        "status": "success",
        "count": len(losers),
        "losers": losers
    }


@app.post("/api/monitor/add")
async def add_symbols_to_monitor(symbols: List[str]):
    """
    모니터링 종목 추가
    
    Args:
        symbols: 추가할 종목 심볼 리스트
    """
    if not realtime_monitor:
        raise HTTPException(status_code=503, detail="Monitor not initialized")
    
    realtime_monitor.add_symbols(symbols)
    
    return {
        "status": "success",
        "message": f"{len(symbols)}개 종목 추가됨",
        "watchlist_size": len(realtime_monitor.watchlist)
    }


@app.post("/api/monitor/remove")
async def remove_symbols_from_monitor(symbols: List[str]):
    """
    모니터링 종목 제거
    
    Args:
        symbols: 제거할 종목 심볼 리스트
    """
    if not realtime_monitor:
        raise HTTPException(status_code=503, detail="Monitor not initialized")
    
    realtime_monitor.remove_symbols(symbols)
    
    return {
        "status": "success",
        "message": f"{len(symbols)}개 종목 제거됨",
        "watchlist_size": len(realtime_monitor.watchlist)
    }


@app.post("/api/monitor/clear")
async def clear_monitor():
    """모든 모니터링 종목 제거"""
    if not realtime_monitor:
        raise HTTPException(status_code=503, detail="Monitor not initialized")
    
    realtime_monitor.clear_watchlist()
    
    return {
        "status": "success",
        "message": "모든 종목 제거됨"
    }


@app.post("/api/monitor/reset")
async def reset_initial_prices():
    """초기 가격 재설정 (현재가를 새 기준으로)"""
    if not realtime_monitor:
        raise HTTPException(status_code=503, detail="Monitor not initialized")
    
    realtime_monitor.reset_initial_prices()
    
    return {
        "status": "success",
        "message": "초기 가격 재설정 완료"
    }


if __name__ == "__main__":
    # 로깅 설정
    logger.add("logs/server_{time}.log", rotation="1 day", retention="7 days")
    
    # 서버 실행
    uvicorn.run(
        "server:app",
        host=config.server.host,
        port=config.server.port,
        reload=config.server.debug,
        log_level="info"
    )

