#!/usr/bin/env python3
"""
FMP API 데이터 범위 테스트
- 1분봉, 5분봉, 15분봉이 각각 몇 개 제공되는지 확인
"""

import sys
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from utils.fmp_api import get_hist_1min, get_hist_5min, get_hist_15min

def test_data_availability(symbol: str = "AAPL"):
    print("=" * 70)
    print(f"🔍 FMP API 데이터 범위 테스트 - {symbol}")
    print("=" * 70)
    
    # 1분봉 테스트
    print(f"\n📊 1분봉 데이터 조회 중...")
    data_1min = get_hist_1min(symbol, minutes=10000)
    if data_1min:
        print(f"  ✅ 1분봉: {len(data_1min)}개 제공")
        days_1min = len(data_1min) / 390  # 정규장 390분 기준
        print(f"     = 약 {days_1min:.1f}일치")
        if len(data_1min) > 0:
            print(f"     최초: {data_1min[0]['date']}")
            print(f"     최종: {data_1min[-1]['date']}")
    else:
        print(f"  ❌ 1분봉 데이터 없음")
    
    # 5분봉 테스트
    print(f"\n📊 5분봉 데이터 조회 중...")
    data_5min = get_hist_5min(symbol, bars=10000)
    if data_5min:
        print(f"  ✅ 5분봉: {len(data_5min)}개 제공")
        days_5min = len(data_5min) * 5 / 390  # 5분봉 기준
        print(f"     = 약 {days_5min:.1f}일치")
        if len(data_5min) > 0:
            print(f"     최초: {data_5min[0]['date']}")
            print(f"     최종: {data_5min[-1]['date']}")
    else:
        print(f"  ❌ 5분봉 데이터 없음")
    
    # 15분봉 테스트
    print(f"\n📊 15분봉 데이터 조회 중...")
    data_15min = get_hist_15min(symbol, bars=10000)
    if data_15min:
        print(f"  ✅ 15분봉: {len(data_15min)}개 제공")
        days_15min = len(data_15min) * 15 / 390  # 15분봉 기준
        print(f"     = 약 {days_15min:.1f}일치")
        if len(data_15min) > 0:
            print(f"     최초: {data_15min[0]['date']}")
            print(f"     최종: {data_15min[-1]['date']}")
    else:
        print(f"  ❌ 15분봉 데이터 없음")
    
    # 권장사항 출력
    print("\n" + "=" * 70)
    print("💡 권장사항")
    print("=" * 70)
    
    if data_1min and len(data_1min) >= 390 * 20:  # 20일치
        print("✅ 1분봉으로 충분한 데이터 확보 가능")
    elif data_5min and len(data_5min) >= 78 * 20:  # 5분봉 20일치 (390/5 * 20)
        print("✅ 5분봉으로 충분한 데이터 확보 가능")
        print("   → features_offline.py를 5분봉으로 전환 권장")
    elif data_15min and len(data_15min) >= 26 * 20:  # 15분봉 20일치 (390/15 * 20)
        print("✅ 15분봉으로 충분한 데이터 확보 가능")
        print("   → features_offline.py를 15분봉으로 전환 권장")
    else:
        print("⚠️ 모든 분봉에서 데이터 부족")
        print("   → ML 학습 대신 실시간 감지만 사용 권장")
    
    print("=" * 70)

if __name__ == "__main__":
    test_data_availability("AAPL")

