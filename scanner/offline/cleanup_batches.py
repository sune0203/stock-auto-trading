# offline/cleanup_batches.py
"""
배치 파일 정리 (병합 후 사용)
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

def cleanup_batches():
    """
    watchlist_batch*.json 파일들을 삭제
    """
    batch_files = list(DATA_DIR.glob("watchlist_batch*.json"))
    
    if not batch_files:
        print("✅ 정리할 배치 파일이 없습니다.")
        return
    
    print(f"🗑️  {len(batch_files)}개의 배치 파일 삭제 중...")
    
    for batch_file in batch_files:
        print(f"   - {batch_file.name}")
        batch_file.unlink()
    
    print(f"\n✅ {len(batch_files)}개 파일 삭제 완료!")

if __name__ == "__main__":
    import sys
    
    print("=" * 70)
    print("⚠️  배치 파일 정리")
    print("=" * 70)
    
    batch_files = list(DATA_DIR.glob("watchlist_batch*.json"))
    print(f"삭제 대상: {len(batch_files)}개 파일")
    
    if not batch_files:
        print("✅ 정리할 파일이 없습니다.")
        sys.exit(0)
    
    for f in batch_files:
        print(f"  - {f.name}")
    
    print("\n정말 삭제하시겠습니까? (y/N): ", end="")
    confirm = input().strip().lower()
    
    if confirm == "y":
        cleanup_batches()
    else:
        print("❌ 취소되었습니다.")

