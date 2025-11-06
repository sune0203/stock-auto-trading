# offline/scanner.py
"""
정규장 패턴형 종목 발굴 스캐너
FMP API를 사용하여 소형주 중 변동성이 크고 거래량이 많은 종목을 선별
"""
import os
import json
import sys
import pandas as pd
from pathlib import Path

# 상위 디렉토리를 경로에 추가
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils.universe import load_universe
from utils.fmp_api import get_profile, get_hist_daily, get_hist_1min
from utils.metrics import atr, simple_rvol, intraday_spread_est

DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

# 필터/스코어 기준 (정규장 전용 1차 버전)
CFG = {
    "price_min": 0.15,           # 최소 주가
    "price_max": 15.0,          # 최대 주가
    "mcap_min": 20_000_000,     # 최소 시가총액 ($20M)
    "mcap_max": 1_500_000_000,  # 최대 시가총액 ($1.5B)
    "min_score": 70,            # 최소 점수 (완화됨)
}

# 디버그 모드 (상세 로그 출력)
DEBUG = True  # False로 바꾸면 간단한 로그만
VERBOSE_SYMBOLS = ["TSLA", "NVDA", "AMD", "MARA", "RIOT"]  # 특정 종목 상세 로그

# 통계 추적
STATS = {
    "total": 0,
    "no_profile": 0,
    "mcap_filtered": 0,
    "no_daily_data": 0,
    "price_filtered": 0,
    "no_1min_data": 0,
    "score_low": 0,
    "passed": 0
}

def pattern_score(symbol: str) -> dict | None:
    """
    심볼 1개에 대해 패턴 점수 계산 후 dict 반환
    스코어 < min_score 이면 None 반환
    
    📊 점수 구성 (총 100점):
    - ATR5 >= 8%: 30점 (>= 5%: 20점)
    - 큰 변동(±20%) 3회 이상: 25점 (1회 이상: 15점)
    - RVOL 피크 >= 3.0: 25점 (>= 2.0: 15점)
    - 스프레드 <= 1.2%: 20점 (<= 2.0%: 10점)
    """
    STATS["total"] += 1
    verbose = DEBUG and symbol in VERBOSE_SYMBOLS
    
    try:
        # 1. 프로필 조회 (시가총액 확인)
        if DEBUG:
            print(f"\n{'='*70}")
            print(f"🔍 [{STATS['total']:4d}] {symbol} 분석 시작")
        
        prof = get_profile(symbol)
        if not prof or len(prof) == 0:
            STATS["no_profile"] += 1
            if DEBUG:
                print(f"  ❌ 프로필 데이터 없음 → 스킵")
            return None
        
        p0 = prof[0]
        # 새 API는 marketCap 사용 (mktCap 아님!)
        mcap = p0.get("marketCap") or 0
        price_current = p0.get("price", 0)
        
        if DEBUG:
            print(f"  ✅ 프로필: 시총=${mcap:,} / 현재가=${price_current:.2f}")
        
        # 시가총액 필터
        if not (CFG["mcap_min"] <= mcap <= CFG["mcap_max"]):
            STATS["mcap_filtered"] += 1
            if DEBUG:
                print(f"  ❌ 시총 필터 탈락: ${mcap:,} (범위: ${CFG['mcap_min']:,}~${CFG['mcap_max']:,})")
            return None

        # 2. 일봉 최근 60일 조회
        daily = get_hist_daily(symbol, days=60)
        if not daily or "historical" not in daily or len(daily["historical"]) < 20:
            STATS["no_daily_data"] += 1
            data_len = len(daily.get("historical", [])) if daily else 0
            if DEBUG:
                print(f"  ❌ 일봉 데이터 부족: {data_len}일 (필요: 20일 이상)")
            return None
        
        if DEBUG:
            print(f"  ✅ 일봉 데이터: {len(daily['historical'])}일")
        
        d = pd.DataFrame(daily["historical"])[["open", "high", "low", "close", "volume"]]
        d.columns = ["o", "h", "l", "c", "v"]
        d = d.iloc[::-1].reset_index(drop=True)  # 오래된 것부터 정렬
        
        # 주가 확인
        price = d["c"].iloc[-1]
        if price <= 0:
            STATS["price_filtered"] += 1
            if DEBUG:
                print(f"  ❌ 주가 0 이하: ${price}")
            return None
        
        # 주가 필터
        if not (CFG["price_min"] <= price <= CFG["price_max"]):
            STATS["price_filtered"] += 1
            if DEBUG:
                print(f"  ❌ 주가 필터 탈락: ${price:.2f} (범위: ${CFG['price_min']}~${CFG['price_max']})")
            return None

        if DEBUG:
            print(f"  ✅ 주가: ${price:.2f} (범위 내)")

        # 3. ATR5 (%) 계산
        atr5 = atr(d, 5).iloc[-1]
        atr5_pct = float(atr5 / price) if price > 0 else 0

        # 4. 최근 20일 ±20% 종가 변동 횟수
        d20 = d.tail(20).copy()
        d20["pct"] = d20["c"].pct_change()
        big_move_cnt = int((d20["pct"].abs() >= 0.20).sum())

        # 5. 1분봉 기반 RVOL / 스프레드
        if DEBUG:
            print(f"  🔄 1분봉 데이터 조회 중...")
        
        m1 = get_hist_1min(symbol, minutes=390*10)  # 약 10일치 정규장
        if not m1 or len(m1) < 200:
            STATS["no_1min_data"] += 1
            data_len = len(m1) if m1 else 0
            if DEBUG:
                print(f"  ❌ 1분봉 데이터 부족: {data_len}분 (필요: 200분 이상)")
            return None
        
        if DEBUG:
            print(f"  ✅ 1분봉 데이터: {len(m1)}분")
        
        df1 = pd.DataFrame(m1)[["date", "open", "high", "low", "close", "volume"]]
        df1.columns = ["ts", "open", "high", "low", "close", "volume"]
        df1 = df1.dropna().reset_index(drop=True)
        df1 = df1.iloc[::-1].reset_index(drop=True)  # 오래된 것부터 정렬
        
        if len(df1) < 200:
            STATS["no_1min_data"] += 1
            if DEBUG:
                print(f"  ❌ 정제 후 1분봉 부족: {len(df1)}분 (필요: 200분 이상)")
            return None

        # RVOL 계산
        rvol = simple_rvol(df1["volume"], base_window=390*5, curr_window=1)
        rvol_peak = float(rvol.tail(390).max())  # 최근 하루 내 최대 RVOL

        # 스프레드 추정
        spread_est = float(intraday_spread_est(df1.rename(columns={
            "open": "o", "high": "high", "low": "low", "close": "close"
        })))

        # 6. 점수 구성 (상세 로그)
        score = 0
        score_details = []
        
        # ATR5 점수
        if atr5_pct >= 0.08:
            score += 30
            score_details.append(f"ATR5={atr5_pct*100:.2f}% (+30점)")
        elif atr5_pct >= 0.05:
            score += 20
            score_details.append(f"ATR5={atr5_pct*100:.2f}% (+20점)")
        else:
            score_details.append(f"ATR5={atr5_pct*100:.2f}% (0점)")

        # 큰 변동 점수
        if big_move_cnt >= 3:
            score += 25
            score_details.append(f"큰변동={big_move_cnt}회 (+25점)")
        elif big_move_cnt >= 1:
            score += 15
            score_details.append(f"큰변동={big_move_cnt}회 (+15점)")
        else:
            score_details.append(f"큰변동={big_move_cnt}회 (0점)")

        # RVOL 점수
        if rvol_peak >= 3.0:
            score += 25
            score_details.append(f"RVOL={rvol_peak:.2f} (+25점)")
        elif rvol_peak >= 2.0:
            score += 15
            score_details.append(f"RVOL={rvol_peak:.2f} (+15점)")
        else:
            score_details.append(f"RVOL={rvol_peak:.2f} (0점)")

        # 스프레드 점수
        if spread_est <= 0.012:
            score += 20
            score_details.append(f"스프레드={spread_est*100:.2f}% (+20점)")
        elif spread_est <= 0.02:
            score += 10
            score_details.append(f"스프레드={spread_est*100:.2f}% (+10점)")
        else:
            score_details.append(f"스프레드={spread_est*100:.2f}% (0점)")

        # 점수 계산 결과 출력 (모든 종목)
        if DEBUG:
            print(f"\n  📊 점수 계산:")
            for detail in score_details:
                print(f"     {detail}")
            print(f"     총점: {score}점 / 기준: {CFG['min_score']}점")

        # 최소 점수 필터
        if score < CFG["min_score"]:
            STATS["score_low"] += 1
            if DEBUG:
                print(f"  ❌ 점수 미달 ({score}점 < {CFG['min_score']}점) → 워치리스트 제외\n")
            return None

        STATS["passed"] += 1
        
        if DEBUG:
            print(f"  🎯 통과! 워치리스트 추가 ✨")
            print(f"{'='*70}\n")
        
        return {
            "symbol": symbol,
            "score": score,
            "price": round(float(price), 3),
            "mcap": int(mcap),
            "atr5_pct": round(atr5_pct*100, 2),
            "big_move_cnt20": big_move_cnt,
            "rvol_peak": round(rvol_peak, 2),
            "spread_est_pct": round(spread_est*100, 2),
        }

    except Exception as e:
        # 에러 발생 시 None 반환 (스킵)
        if DEBUG:
            print(f"  ⚠️ 에러 발생: {e}")
            print(f"  → 스킵\n")
        return None

def main(start_idx: int = 0, end_idx: int | None = None, batch_id: str = ""):
    """
    전체 유니버스를 순회하며 패턴 점수 계산
    
    Args:
        start_idx: 시작 인덱스 (0부터)
        end_idx: 종료 인덱스 (None이면 끝까지)
        batch_id: 배치 식별자 (예: "1", "2" - 파일명에 사용)
    """
    universe = load_universe()
    
    # 배치 슬라이싱
    if end_idx is None:
        end_idx = len(universe)
    
    universe_batch = universe[start_idx:end_idx]
    
    print("=" * 70)
    print(f"📊 FMP 스캐너 시작 {'[배치 ' + batch_id + ']' if batch_id else ''}")
    print("=" * 70)
    print(f"전체 유니버스: {len(universe)} 종목")
    print(f"이번 배치: {start_idx}~{end_idx} ({len(universe_batch)} 종목)")
    print(f"필터 조건:")
    print(f"  - 주가: ${CFG['price_min']}~${CFG['price_max']}")
    print(f"  - 시가총액: ${CFG['mcap_min']:,}~${CFG['mcap_max']:,}")
    print(f"  - 최소 점수: {CFG['min_score']}점")
    print(f"  - 디버그 모드: {'ON' if DEBUG else 'OFF'}")
    
    print("\n스캐닝 시작...\n")

    results = []
    
    # 배치별 파일명
    if batch_id:
        out_path = DATA_DIR / f"watchlist_batch{batch_id}.json"
    else:
        out_path = DATA_DIR / "watchlist.json"
    
    for i, sym in enumerate(universe_batch, start=start_idx+1):
        try:
            r = pattern_score(sym)
            if r:
                results.append(r)
                print(f"\n✅ [발견 #{len(results)}] {sym}: {r['score']}점 | ${r['price']:.2f} | "
                      f"ATR={r['atr5_pct']:.1f}% | RVOL={r['rvol_peak']:.1f}")
                
                # 발견 즉시 저장 (점수순 정렬)
                sorted_results = sorted(results, key=lambda x: x["score"], reverse=True)
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump({
                        "symbols": [r["symbol"] for r in sorted_results],
                        "detail": sorted_results,
                        "total": len(sorted_results),
                        "config": CFG,
                        "stats": STATS
                    }, f, indent=2, ensure_ascii=False)
                
                if DEBUG:
                    print(f"   💾 watchlist.json 업데이트됨 ({len(results)}개 저장)")
                
        except Exception as e:
            if DEBUG:
                print(f"❌ [ERR] {sym}: {e}")
        
        # 진행 상황 + 통계 출력
        if (i - start_idx) % 100 == 0:
            processed = i - start_idx
            pass_rate = (STATS["passed"] / STATS["total"] * 100) if STATS["total"] > 0 else 0
            print(f"\n{'='*70}")
            print(f"진행: {i}/{end_idx} (배치 내: {processed}/{len(universe_batch)}, {processed/len(universe_batch)*100:.1f}%)")
            print(f"발견: {len(results)}개 (통과율: {pass_rate:.3f}%)")
            print(f"필터 통계:")
            total = STATS["total"]
            if total > 0:
                print(f"  - 프로필 없음: {STATS['no_profile']} ({STATS['no_profile']/total*100:.1f}%)")
                print(f"  - 시총 탈락: {STATS['mcap_filtered']} ({STATS['mcap_filtered']/total*100:.1f}%)")
                print(f"  - 일봉 없음: {STATS['no_daily_data']} ({STATS['no_daily_data']/total*100:.1f}%)")
                print(f"  - 주가 탈락: {STATS['price_filtered']} ({STATS['price_filtered']/total*100:.1f}%)")
                print(f"  - 1분봉 없음: {STATS['no_1min_data']} ({STATS['no_1min_data']/total*100:.1f}%)")
                print(f"  - 점수 미달: {STATS['score_low']} ({STATS['score_low']/total*100:.1f}%)")
            print(f"{'='*70}\n")

    # 최종 정렬 및 저장 (이미 실시간으로 저장했지만 최종 확인)
    results = sorted(results, key=lambda x: x["score"], reverse=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "symbols": [r["symbol"] for r in results],
            "detail": results,
            "total": len(results),
            "config": CFG,
            "stats": STATS
        }, f, indent=2, ensure_ascii=False)
    
    # 최종 리포트
    print("\n" + "=" * 70)
    print("🎯 스캐닝 완료!")
    print("=" * 70)
    print(f"저장 경로: {out_path}")
    print(f"\n📊 최종 통계:")
    print(f"  총 처리: {STATS['total']} 종목")
    print(f"  발견: {len(results)} 종목 ({len(results)/STATS['total']*100:.3f}%)")
    print(f"\n  탈락 사유:")
    print(f"    프로필 없음:  {STATS['no_profile']:4d} ({STATS['no_profile']/STATS['total']*100:5.1f}%)")
    print(f"    시총 필터:    {STATS['mcap_filtered']:4d} ({STATS['mcap_filtered']/STATS['total']*100:5.1f}%)")
    print(f"    일봉 데이터:  {STATS['no_daily_data']:4d} ({STATS['no_daily_data']/STATS['total']*100:5.1f}%)")
    print(f"    주가 필터:    {STATS['price_filtered']:4d} ({STATS['price_filtered']/STATS['total']*100:5.1f}%)")
    print(f"    1분봉 데이터: {STATS['no_1min_data']:4d} ({STATS['no_1min_data']/STATS['total']*100:5.1f}%)")
    print(f"    점수 미달:    {STATS['score_low']:4d} ({STATS['score_low']/STATS['total']*100:5.1f}%)")
    
    if results:
        print(f"\n🏆 상위 10개 종목:")
        print("=" * 70)
        for i, r in enumerate(results[:10], 1):
            print(f"{i:2d}. {r['symbol']:6s} | 점수: {r['score']:3d} | 가격: ${r['price']:7.2f} | "
                  f"ATR5: {r['atr5_pct']:5.2f}% | RVOL: {r['rvol_peak']:5.2f} | "
                  f"변동: {r['big_move_cnt20']}회")
    else:
        print(f"\n⚠️ 조건을 만족하는 종목이 없습니다!")
        print(f"\n💡 권장사항:")
        print(f"  1. min_score를 낮추기 (현재: {CFG['min_score']}점 → 권장: 30점)")
        print(f"  2. 주가 범위 확대 (현재: ${CFG['price_min']}~${CFG['price_max']})")
        print(f"  3. 시총 범위 확대")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="FMP 스캐너 - 배치 처리 지원")
    parser.add_argument("--start", type=int, default=0, help="시작 인덱스 (기본: 0)")
    parser.add_argument("--end", type=int, default=None, help="종료 인덱스 (기본: 끝까지)")
    parser.add_argument("--batch", type=str, default="", help="배치 ID (예: 1, 2, 3)")
    
    args = parser.parse_args()
    
    main(start_idx=args.start, end_idx=args.end, batch_id=args.batch)

