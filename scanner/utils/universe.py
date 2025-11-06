# utils/universe.py
"""
거래소 종목 마스터 파일에서 심볼 리스트를 로딩하는 유틸리티
"""
import os
from typing import List, Set

# 루트 디렉토리: chart-core/scanner 기준
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
# data 디렉토리는 chart-core/data 참조
DATA_DIR = os.path.abspath(os.path.join(ROOT, "..", "data"))

MASTER_FILES = [
    os.path.join(DATA_DIR, "amsmst.txt"),   # AMEX
    os.path.join(DATA_DIR, "nasmst.txt"),   # NASDAQ
    os.path.join(DATA_DIR, "nysmst.txt"),   # NYSE
]

def _load_one(path: str) -> List[str]:
    """
    단일 마스터 파일에서 심볼 추출
    탭으로 구분된 파일에서 5번째 컬럼(심볼) 추출
    """
    syms = []
    if not os.path.exists(path):
        print(f"[WARN] 파일 없음: {path}")
        return syms
    
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            # 탭으로 구분, 5번째 컬럼이 심볼
            parts = line.split('\t')
            if len(parts) >= 5:
                symbol = parts[4].strip()
                # 슬래시 포함한 심볼 제외 (우선주 등)
                # 너무 긴 문자열 필터링
                if '/' not in symbol and 1 <= len(symbol) <= 6:
                    syms.append(symbol.upper())
    return syms

def load_universe() -> List[str]:
    """
    AMEX + NASDAQ + NYSE 전체 심볼 리스트 반환
    중복 제거 후 정렬된 리스트
    """
    all_syms: Set[str] = set()
    for p in MASTER_FILES:
        all_syms.update(_load_one(p))
    return sorted(all_syms)

if __name__ == "__main__":
    syms = load_universe()
    print(f"전체 종목 수: {len(syms)}")
    print(f"처음 50개: {syms[:50]}")

