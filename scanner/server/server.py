# server/server.py
"""
정규장/프리/애프터 실시간 신호 서버
멀티 타임프레임 + ML 모델 + 세션별 전략
"""
import os
import json
import asyncio
import datetime as dt
import sys
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uvicorn

# 상위 디렉토리를 경로에 추가
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils.fmp_api import get_batch_quotes, get_batch_aftermarket_quotes, get_hist_15min
from server.signal_engine import SignalEngine
from server.market_session import get_session_info, get_market_session
from server.data_cache import HIST_CACHE
from xgboost import XGBClassifier

DATA_DIR = ROOT / "data"
MODEL_PATH = DATA_DIR / "model_xgb_30m.json"
STATS_PATH = DATA_DIR / "symbol_stats.json"
WEB_DIR = ROOT / "web"

# 전역 변수
MODEL = None
SYM_STATS = {}
SIGNAL_ENGINE = None

def load_model_and_stats():
    """
    ML 모델 및 심볼 통계 로드
    """
    global MODEL, SYM_STATS, SIGNAL_ENGINE
    
    if not MODEL_PATH.exists():
        print(f"[ERROR] 모델 파일 없음: {MODEL_PATH}")
        print("[INFO] 먼저 학습을 실행하세요: python offline/train_daily.py")
        return False
    
    if not STATS_PATH.exists():
        print(f"[ERROR] 통계 파일 없음: {STATS_PATH}")
        return False
    
    try:
        MODEL = XGBClassifier()
        MODEL.load_model(str(MODEL_PATH))
        print(f"[MODEL] XGBoost 모델 로드 완료: {MODEL_PATH.name}")
        
        SYM_STATS = json.load(open(STATS_PATH, "r"))
        print(f"[STATS] 심볼 통계 로드 완료: {len(SYM_STATS)}개")
        
        SIGNAL_ENGINE = SignalEngine(MODEL, SYM_STATS)
        print(f"[ENGINE] 신호 엔진 초기화 완료")
        
        return True
    
    except Exception as e:
        print(f"[ERROR] 모델 로드 실패: {e}")
        import traceback
        traceback.print_exc()
        return False

async def warmup_cache():
    """
    캐시 워밍업: 모든 watchlist 종목의 15분봉 미리 로드
    초기 로딩 시간은 걸리지만, 이후 분석이 훨씬 빨라짐
    """
    syms = load_watchlist()
    if not syms:
        print("[WARN] Watchlist가 비어있어 캐시 워밍업을 건너뜁니다.")
        return
    
    print(f"\n[CACHE] 캐시 워밍업 시작... ({len(syms)}개 종목)")
    print(f"[CACHE] 예상 소요 시간: {len(syms) * 0.3:.0f}초 (약 {len(syms) * 0.3 / 60:.1f}분)")
    
    success = 0
    failed = 0
    
    import time
    start_time = time.time()
    
    for i, sym in enumerate(syms, 1):
        try:
            data = get_hist_15min(sym, bars=50)
            if data and len(data) >= 20:
                HIST_CACHE.set(sym, data)
                success += 1
            else:
                failed += 1
            
            # 진행률 표시 (10% 단위)
            if i % (len(syms) // 10 + 1) == 0:
                elapsed = time.time() - start_time
                progress = i / len(syms) * 100
                eta = (elapsed / i) * (len(syms) - i)
                print(f"[CACHE] 진행: {progress:.0f}% ({i}/{len(syms)}) | " +
                      f"성공: {success} | 실패: {failed} | " +
                      f"남은 시간: {eta:.0f}초")
            
            # API 레이트 리밋 고려 (짧은 딜레이)
            await asyncio.sleep(0.2)
        
        except Exception as e:
            failed += 1
            if failed <= 5:  # 처음 5개 실패만 로그
                print(f"[ERROR] {sym} 캐시 워밍업 실패: {e}")
    
    elapsed = time.time() - start_time
    print(f"\n[CACHE] 캐시 워밍업 완료!")
    print(f"[CACHE] 소요 시간: {elapsed:.1f}초 ({elapsed/60:.1f}분)")
    print(f"[CACHE] 성공: {success}개 | 실패: {failed}개")
    print(f"[CACHE] 캐시 통계: {HIST_CACHE.get_stats()}\n")

# FastAPI 앱 생성
app = FastAPI(title="Multi-Session Scanner with ML")

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket 클라이언트 관리
CLIENTS = set()

def load_watchlist():
    """
    watchlist.json에서 감시 대상 종목 로드
    """
    p = DATA_DIR / "watchlist.json"
    if not p.exists():
        return []
    
    try:
        obj = json.load(open(p, "r"))
        return obj.get("symbols", [])
    except Exception as e:
        print(f"[ERROR] watchlist 로드 실패: {e}")
        return []

@app.get("/api")
async def api_status():
    """
    API 상태 체크 엔드포인트
    """
    session_info = get_session_info()
    return {
        "status": "online",
        "session": session_info["session_name"],
        "us_time": session_info["us_time"],
        "is_trading": session_info["is_trading"],
        "model_loaded": MODEL is not None,
        "watchlist_count": len(load_watchlist())
    }

@app.get("/watchlist")
async def get_watchlist():
    """
    Watchlist 조회
    """
    syms = load_watchlist()
    # watchlist.json의 symbols는 문자열 리스트
    return {
        "count": len(syms),
        "symbols": syms,  # 이미 문자열 리스트
        "session": get_market_session()
    }

@app.get("/")
async def index():
    """
    웹 UI 제공
    """
    return FileResponse(WEB_DIR / "index.html")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket 연결 처리
    """
    await websocket.accept()
    CLIENTS.add(websocket)
    print(f"[WS] 클라이언트 연결됨 (총 {len(CLIENTS)}개)")
    
    try:
        while True:
            # 연결 유지 (클라이언트로부터 메시지 대기)
            await websocket.receive_text()
    except Exception as e:
        print(f"[WS] 연결 종료: {e}")
    finally:
        CLIENTS.discard(websocket)
        print(f"[WS] 클라이언트 연결 해제됨 (총 {len(CLIENTS)}개)")

async def broadcast(data: dict):
    """
    모든 WebSocket 클라이언트에게 데이터 전송
    """
    if not CLIENTS:
        return
    
    dead = set()
    for client in CLIENTS:
        try:
            await client.send_json(data)
        except Exception as e:
            print(f"[WS] 전송 실패: {e}")
            dead.add(client)
    
    # 죽은 연결 제거
    for d in dead:
        CLIENTS.discard(d)

async def monitor_loop():
    """
    메인 모니터링 루프 (세션별 전략)
    """
    if not SIGNAL_ENGINE:
        print("[ERROR] 신호 엔진이 초기화되지 않았습니다!")
        return
    
    print("\n[MONITOR] 멀티 세션 + ML 모니터링 시작...")
    
    # 이전 가격 캐시 (변화 감지용)
    prev_prices = {}
    
    # 마지막 신호 시간 (쿨다운 방지)
    last_signal_time = {}
    COOLDOWN_MINUTES = 30
    
    while True:
        try:
            # 현재 세션 확인
            session_info = get_session_info()
            session = session_info["session"]
            
            # 장 마감 시간
            if session == "CLOSED":
                print(f"\n[{dt.datetime.now().strftime('%H:%M:%S')}] 장 마감 - 60초 대기...")
                await asyncio.sleep(60)
                continue
            
            # Watchlist 로드
            syms = load_watchlist()
            if not syms:
                print("[WARN] Watchlist가 비어있습니다.")
                await asyncio.sleep(10)
                continue
            
            # 세션별로 다른 API 사용
            batch_size = 50
            all_quotes = []
            
            for i in range(0, len(syms), batch_size):
                # syms는 이미 문자열 리스트 (예: ["AAPL", "MSFT", ...])
                batch = syms[i:i+batch_size]
                
                # 정규장: batch-quote, 프리/애프터: batch-aftermarket-trade
                if session == "RTH":
                    quotes = get_batch_quotes(batch)
                else:  # PRE or AFTER
                    quotes = get_batch_aftermarket_quotes(batch)
                
                if quotes:
                    all_quotes.extend(quotes)
                await asyncio.sleep(0.3)
            
            # 변화가 있는 종목 필터링
            symbols_to_analyze = []
            for quote in all_quotes:
                sym = quote.get("symbol")
                price = quote.get("price", 0)
                
                if session == "RTH":
                    # 정규장: changePercentage 사용 가능
                    change_pct = abs(quote.get("changePercentage", 0))
                    
                    # 조건: 1% 이상 변화 or 0.5% 최근 변화
                    if change_pct >= 1.0:
                        symbols_to_analyze.append(sym)
                    elif sym in prev_prices:
                        prev_price = prev_prices[sym]
                        if prev_price > 0:
                            recent_change = abs((price - prev_price) / prev_price)
                            if recent_change >= 0.005:
                                symbols_to_analyze.append(sym)
                else:
                    # 프리/애프터: changePercentage 없음, 이전 가격과 비교
                    if sym in prev_prices:
                        prev_price = prev_prices[sym]
                        if prev_price > 0:
                            recent_change = abs((price - prev_price) / prev_price)
                            if recent_change >= 0.005:  # 0.5% 이상 변화
                                symbols_to_analyze.append(sym)
                    else:
                        # 첫 체크: 모든 종목 분석
                        symbols_to_analyze.append(sym)
                
                prev_prices[sym] = price
            
            print(f"\n[{dt.datetime.now().strftime('%H:%M:%S')}] {session_info['session_name']} | " +
                  f"{len(syms)}개 중 {len(symbols_to_analyze)}개 종목 분석")
            
            # 세션별 분석
            for sym in symbols_to_analyze:
                try:
                    # 쿨다운 체크
                    if sym in last_signal_time:
                        elapsed = (dt.datetime.now() - last_signal_time[sym]).total_seconds() / 60
                        if elapsed < COOLDOWN_MINUTES:
                            continue
                    
                    # 세션별 분석 전략
                    if session == "RTH":
                        # 정규장: 1/5/15분봉 + 현재가
                        result = SIGNAL_ENGINE.analyze_symbol_rth(sym)
                    else:
                        # 프리/애프터: 현재가 + 이전 정규장 데이터
                        # all_quotes에서 현재가 찾기
                        current_price = next((q["price"] for q in all_quotes if q["symbol"] == sym), None)
                        if not current_price or current_price <= 0:
                            continue
                        result = SIGNAL_ENGINE.analyze_symbol_pre_after(sym, current_price, session)
                    
                    if not result["current_price"]:
                        continue
                    
                    # 신호 발생 체크
                    for tf_name, sig_data in result["signals"].items():
                        if sig_data["signal"]:
                            now = dt.datetime.now().isoformat()
                            
                            feats = sig_data["features"]
                            
                            # 페이로드 생성
                            payload = {
                                "t": now,
                                "session": session,
                                "timeframe": tf_name,
                                "symbol": sym,
                                "state": "MLSignal",
                                "price": float(result["current_price"]),
                                "rvol_15m": float(feats["rvol"]),
                                "base_range_pct": float(feats["base_range"] * 100),
                                "spread_pct": float(feats["spread_est"] * 100),
                                "move_pct": float(feats["move_prev"] * 100),
                                "realtime_move_pct": float(feats["realtime_move"] * 100),
                                "ml_score": float(sig_data["ml_score"]),
                                "ml_threshold": float(sig_data["threshold"]),
                            }
                            
                            # 브로드캐스트
                            await broadcast(payload)
                            
                            # 로그 출력
                            print(f"  🎯 [{session}] [{tf_name.upper()}] {sym} @ ${result['current_price']:.2f} | " +
                                  f"ML: {sig_data['ml_score']:.3f} (임계: {sig_data['threshold']:.3f}) | " +
                                  f"RVOL: {feats['rvol']:.2f} | " +
                                  f"변동: {feats['move_prev']*100:+.2f}% | " +
                                  f"실시간: {feats['realtime_move']*100:+.2f}%")
                            
                            # 쿨다운 설정
                            last_signal_time[sym] = dt.datetime.now()
                            break  # 동일 종목은 첫 신호만
                
                except Exception as e:
                    print(f"  [ERROR] {sym}: {e}")
                
                await asyncio.sleep(0.1)
        
        except Exception as e:
            print(f"[ERROR] 모니터링 루프: {e}")
        
        # 대기 시간 (세션별 조정)
        if session == "RTH":
            await asyncio.sleep(10)  # 정규장: 10초
        else:
            await asyncio.sleep(30)  # 프리/애프터: 30초

@app.on_event("startup")
async def startup_event():
    """
    서버 시작 시 초기화
    """
    print("\n" + "="*70)
    print("🚀 Multi-Session Scanner with ML")
    print("="*70)
    
    # 현재 세션 정보
    session_info = get_session_info()
    print(f"📅 미국 시간: {session_info['us_time']}")
    print(f"🕐 현재 세션: {session_info['session_name']} ({session_info['session']})")
    print(f"🔄 거래 가능: {'예' if session_info['is_trading'] else '아니오'}")
    print(f"📊 분봉 사용: {'가능' if session_info['has_intraday_data'] else '불가 (이전 데이터 활용)'}")
    
    # 모델 로드
    if not load_model_and_stats():
        print("\n[ERROR] 모델 로드 실패 - 서버 종료")
        import sys
        sys.exit(1)
    
    print(f"📋 Watchlist: {len(load_watchlist())} 종목")
    print(f"🌐 Web UI: http://localhost:8800")
    print(f"📡 API: http://localhost:8800/docs")
    print("="*70 + "\n")
    
    # 캐시 워밍업 (백그라운드 실행)
    asyncio.create_task(warmup_cache())
    
    # 백그라운드 모니터링 시작 (캐시 워밍업과 병렬 실행)
    asyncio.create_task(monitor_loop())

if __name__ == "__main__":
    # 서버 실행
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8800,
        log_level="info"
    )
