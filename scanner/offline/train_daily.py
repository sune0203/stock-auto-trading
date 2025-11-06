# offline/train_daily.py
"""
전역 모델 + 티커별 통계 학습
XGBoost를 사용한 분류 모델 학습 (Windows 호환)
"""
import os
import json
import pickle
import sys
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, classification_report
from xgboost import XGBClassifier

# 상위 디렉토리를 경로에 추가
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DATA_DIR = ROOT / "data"
FEATURES_PATH = DATA_DIR / "offline_features.parquet"
MODEL_PATH = DATA_DIR / "model_xgb_30m.json"  # XGBoost는 json 형식
SYM_STATS_PATH = DATA_DIR / "symbol_stats.json"

# 피처 컬럼 (15분봉 기준)
FEATURES = ["rvol_15m", "base_range", "spread_est", "move_prev"]
TARGET = "label_30m"  # 15분봉 2개 = 30분

def compute_sym_stats(df: pd.DataFrame) -> dict:
    """
    티커별 성공 케이스 통계 계산
    """
    out = {}
    
    for sym, g in df.groupby("symbol"):
        # 성공한 케이스만 필터링
        ok = g[g[TARGET] == 1]
        
        if len(ok) == 0:
            continue
        
        # 성공 케이스의 주요 지표 분위수
        out[sym] = {
            "total_events": len(g),
            "success_events": len(ok),
            "success_rate": float(len(ok) / len(g)),
            "rvol_success_q60": float(ok["rvol_15m"].quantile(0.60)),
            "spread_success_q90": float(ok["spread_est"].quantile(0.90)),
            "score_success_q70": 0.65,  # 초기값, 나중에 점수 분포로 조정
        }
    
    return out

def main():
    """
    모델 학습 및 통계 저장
    """
    print("=" * 70)
    print("🤖 모델 학습 시작")
    print("=" * 70)
    
    # 1. 데이터 로드
    if not FEATURES_PATH.exists():
        print(f"❌ 오프라인 피처 파일이 없습니다: {FEATURES_PATH}")
        print("💡 features_offline.py를 먼저 실행하세요.")
        return
    
    print(f"\n📂 데이터 로드 중...")
    print(f"   경로: {FEATURES_PATH}")
    df = pd.read_parquet(FEATURES_PATH)
    print(f"   ✅ 원본 데이터: {len(df):,}행")
    
    print(f"\n🔄 데이터 전처리 중...")
    df = df.dropna(subset=[TARGET] + FEATURES).copy()
    print(f"   ✅ 결측치 제거 후: {len(df):,}행")
    
    print(f"\n📊 데이터 분포:")
    print(f"   종목 수: {df['symbol'].nunique()}개")
    print(f"   기간: {df['ts'].min()} ~ {df['ts'].max()}")
    
    print(f"\n📈 타겟 분포 ({TARGET}):")
    target_counts = df[TARGET].value_counts().sort_index()
    for label, count in target_counts.items():
        label_name = "성공" if label == 1 else "실패"
        print(f"   {label_name}(={label}): {count:4d} ({count/len(df)*100:5.1f}%)")

    # 2. 데이터 충분성 체크
    if len(df) < 200:
        print(f"\n❌ 데이터가 부족합니다 (현재: {len(df)}개, 최소: 200개)")
        print("💡 더 많은 종목을 스캔하거나 조건을 완화하세요.")
        return

    # 3. 피처/타겟 분리
    print(f"\n📊 피처/타겟 분리 중...")
    print(f"   피처: {FEATURES}")
    print(f"   타겟: {TARGET}")
    X = df[FEATURES].values
    y = df[TARGET].values.astype(int)
    print(f"   ✅ X shape: {X.shape}, y shape: {y.shape}")

    # 4. Train/Test 분할
    print(f"\n✂️ Train/Test 분할 중... (Test=20%)")
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=0.2, shuffle=True, random_state=42
    )
    
    print(f"   Train: {len(X_tr):,}개 ({len(X_tr)/len(X)*100:.1f}%)")
    print(f"   Test:  {len(X_te):,}개 ({len(X_te)/len(X)*100:.1f}%)")
    
    # Train 타겟 분포
    train_success = (y_tr == 1).sum()
    print(f"   Train 타겟: 성공={train_success} ({train_success/len(y_tr)*100:.1f}%), 실패={len(y_tr)-train_success}")

    # 5. 모델 학습
    print(f"\n🤖 모델 학습 중...")
    print(f"   알고리즘: XGBoost Classifier (Windows 최적화)")
    print(f"   설정:")
    print(f"     - n_estimators: 400")
    print(f"     - learning_rate: 0.03")
    print(f"     - max_depth: 6")
    print(f"     - scale_pos_weight: auto")
    
    # 클래스 불균형 처리
    scale_pos_weight = (y_tr == 0).sum() / (y_tr == 1).sum()
    
    model = XGBClassifier(
        n_estimators=400,
        learning_rate=0.03,
        max_depth=6,
        scale_pos_weight=scale_pos_weight,
        random_state=42,
        verbosity=0,  # 로그 최소화
        use_label_encoder=False,
        eval_metric='logloss'
    )
    model.fit(X_tr, y_tr)
    print(f"   ✅ 학습 완료!")

    # 6. 검증
    print("\n" + "=" * 70)
    print("📊 검증 결과")
    print("=" * 70)
    
    print(f"\n🔮 예측 수행 중...")
    prob_te = model.predict_proba(X_te)[:, 1]
    y_pred = model.predict(X_te)
    print(f"   ✅ 예측 완료")
    
    # AUC 계산
    try:
        auc = roc_auc_score(y_te, prob_te)
        print(f"\n📈 AUC Score: {auc:.4f}")
        if auc > 0.7:
            print(f"   🎯 우수한 성능!")
        elif auc > 0.6:
            print(f"   ✅ 양호한 성능")
        else:
            print(f"   ⚠️ 성능 개선 필요")
    except Exception as e:
        print(f"\n⚠️ AUC 계산 불가: {e}")

    # 분류 리포트
    print(f"\n📊 분류 리포트:")
    print("=" * 70)
    print(classification_report(y_te, y_pred, target_names=["실패", "성공"]))
    print("=" * 70)

    # 7. 전체 데이터에 대한 점수 계산
    print(f"\n🔮 전체 데이터 점수 계산 중...")
    df["score"] = model.predict_proba(df[FEATURES].values)[:, 1]
    print(f"   ✅ 완료")
    print(f"   점수 범위: {df['score'].min():.4f} ~ {df['score'].max():.4f}")
    print(f"   점수 평균: {df['score'].mean():.4f}")
    
    # 8. 티커별 통계 계산
    print(f"\n📊 티커별 통계 계산 중...")
    sym_stats = compute_sym_stats(df)
    print(f"   ✅ {len(sym_stats)}개 종목 통계 생성 완료")
    
    if len(sym_stats) > 0:
        # 상위 5개 종목 통계 출력
        sorted_stats = sorted(sym_stats.items(), key=lambda x: x[1]['success_rate'], reverse=True)
        print(f"\n   🏆 성공률 상위 5개 종목:")
        for i, (sym, stat) in enumerate(sorted_stats[:5], 1):
            print(f"      {i}. {sym:6s}: 성공률 {stat['success_rate']*100:.1f}% "
                  f"({stat['success_events']}/{stat['total_events']} 이벤트)")

    # 9. 저장
    print("\n" + "=" * 70)
    print("💾 파일 저장")
    print("=" * 70)
    
    DATA_DIR.mkdir(exist_ok=True)
    
    # 모델 저장 (XGBoost는 JSON 형식)
    print(f"\n📦 모델 저장 중...")
    print(f"   경로: {MODEL_PATH}")
    model.save_model(str(MODEL_PATH))
    print(f"   ✅ 모델 저장 완료 ({MODEL_PATH.stat().st_size / 1024:.1f} KB)")
    
    # 통계 저장
    print(f"\n📊 통계 저장 중...")
    print(f"   경로: {SYM_STATS_PATH}")
    with open(SYM_STATS_PATH, "w") as f:
        json.dump(sym_stats, f, indent=2)
    print(f"   ✅ 통계 저장 완료 ({SYM_STATS_PATH.stat().st_size / 1024:.1f} KB)")
    
    # 10. 피처 중요도
    print("\n" + "=" * 70)
    print("🔍 피처 중요도")
    print("=" * 70)
    
    importance = pd.DataFrame({
        'feature': FEATURES,
        'importance': model.feature_importances_
    }).sort_values('importance', ascending=False)
    
    print()
    for idx, row in importance.iterrows():
        feat = row['feature']
        imp = row['importance']
        bar_len = int(imp * 50)  # 0~1 범위를 0~50으로 변환
        bar = '█' * bar_len
        print(f"   {feat:15s} | {bar} {imp:.4f}")
    
    # 최종 리포트
    print("\n" + "=" * 70)
    print("🎯 학습 완료!")
    print("=" * 70)
    print(f"\n📁 생성된 파일:")
    print(f"   1. {MODEL_PATH}")
    print(f"   2. {SYM_STATS_PATH}")
    
    print(f"\n📊 요약:")
    print(f"   학습 데이터: {len(X_tr):,}개")
    print(f"   테스트 데이터: {len(X_te):,}개")
    print(f"   종목 통계: {len(sym_stats)}개")
    
    print(f"\n💡 다음 단계:")
    print(f"   python server/server.py")
    print("=" * 70)

if __name__ == "__main__":
    main()

