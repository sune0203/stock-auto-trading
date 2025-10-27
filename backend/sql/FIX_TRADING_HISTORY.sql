-- =========================================
-- 잘못된 거래내역 삭제 및 재동기화
-- =========================================

-- 1. 현재 상태 확인
SELECT '=== 삭제 전 상태 ===' as '';
SELECT * FROM _TRADING_HISTORY ORDER BY th_timestamp DESC;

-- 2. 잘못된 데이터 삭제 (수량이 0이거나 가격이 0인 데이터)
DELETE FROM _TRADING_HISTORY 
WHERE th_quantity = 0 OR th_price = 0;

-- 3. 삭제 후 상태 확인
SELECT '=== 삭제 후 상태 ===' as '';
SELECT * FROM _TRADING_HISTORY ORDER BY th_timestamp DESC;

-- 4. 결과
SELECT '=== 삭제 완료 ===' as '';
SELECT CONCAT('남은 거래내역: ', COUNT(*), '개') as result FROM _TRADING_HISTORY;

