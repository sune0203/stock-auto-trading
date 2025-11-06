# offline/merge_batches.py
"""
배치별로 실행된 스캐너 결과를 병합
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

def merge_batches():
    """
    watchlist_batch*.json 파일들을 하나로 병합
    """
    batch_files = list(DATA_DIR.glob("watchlist_batch*.json"))
    
    if not batch_files:
        print("❌ 병합할 배치 파일이 없습니다.")
        return
    
    print(f"📦 {len(batch_files)}개의 배치 파일 발견")
    print("=" * 70)
    
    all_results = []
    all_stats = {
        "total": 0,
        "no_profile": 0,
        "mcap_filtered": 0,
        "no_daily_data": 0,
        "price_filtered": 0,
        "no_1min_data": 0,
        "score_low": 0,
        "passed": 0
    }
    
    config = None
    
    # 각 배치 파일 읽기
    for batch_file in sorted(batch_files):
        print(f"📄 읽는 중: {batch_file.name}")
        
        with open(batch_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        # 결과 병합
        all_results.extend(data.get("detail", []))
        
        # 통계 병합
        stats = data.get("stats", {})
        for key in all_stats:
            all_stats[key] += stats.get(key, 0)
        
        # 설정 저장 (첫 번째 것 사용)
        if config is None:
            config = data.get("config", {})
        
        print(f"  ✅ {data.get('total', 0)}개 종목")
    
    # 중복 제거 (symbol 기준, 점수가 높은 것만)
    unique_results = {}
    for r in all_results:
        sym = r["symbol"]
        if sym not in unique_results or r["score"] > unique_results[sym]["score"]:
            unique_results[sym] = r
    
    final_results = list(unique_results.values())
    
    # 점수 순 정렬
    final_results = sorted(final_results, key=lambda x: x["score"], reverse=True)
    
    # 병합된 결과 저장
    out_path = DATA_DIR / "watchlist.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "symbols": [r["symbol"] for r in final_results],
            "detail": final_results,
            "total": len(final_results),
            "config": config,
            "stats": all_stats
        }, f, indent=2, ensure_ascii=False)
    
    print("\n" + "=" * 70)
    print("🎯 병합 완료!")
    print("=" * 70)
    print(f"저장 경로: {out_path}")
    print(f"\n📊 최종 결과:")
    print(f"  총 처리: {all_stats['total']} 종목")
    print(f"  발견: {len(final_results)} 종목 (통과율: {len(final_results)/all_stats['total']*100:.3f}%)")
    
    if final_results:
        print(f"\n🏆 상위 10개 종목:")
        print("=" * 70)
        for i, r in enumerate(final_results[:10], 1):
            print(f"{i:2d}. {r['symbol']:6s} | 점수: {r['score']:3d} | 가격: ${r['price']:7.2f} | "
                  f"ATR5: {r['atr5_pct']:5.2f}% | RVOL: {r['rvol_peak']:5.2f}")
    
    # 배치 파일 정리 여부 확인
    print("\n" + "=" * 70)
    print("💡 배치 파일 정리:")
    print(f"   {len(batch_files)}개의 배치 파일이 있습니다.")
    print(f"   삭제하려면: python offline/cleanup_batches.py")

if __name__ == "__main__":
    merge_batches()

