-- =========================================
-- 잘못된 거래내역 완전 삭제 및 재동기화 준비
-- =========================================

-- 1. 현재 상태 확인
SELECT '=== 삭제 전 상태 ===' as '';
SELECT 
    th_id,
    th_ticker,
    th_type,
    th_quantity,
    th_price,
    th_amount,
    th_timestamp,
    th_reason
FROM _TRADING_HISTORY 
ORDER BY th_timestamp DESC;

-- 2. 모든 거래내역 삭제 (재동기화 준비)
DELETE FROM _TRADING_HISTORY;

-- 3. AUTO_INCREMENT 초기화
ALTER TABLE _TRADING_HISTORY AUTO_INCREMENT = 1;

-- 4. 삭제 완료 확인
SELECT '=== 삭제 완료 ===' as '';
SELECT COUNT(*) as remaining_count FROM _TRADING_HISTORY;

-- =========================================
-- 이제 서버가 자동으로 KIS API에서 재동기화합니다
-- =========================================

