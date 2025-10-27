-- =========================================
-- 날짜 오류 확인 및 재동기화
-- =========================================

-- 1. 현재 날짜 순서 확인
SELECT '=== 현재 거래내역 날짜 순서 ===' as '';
SELECT 
    th_id,
    th_ticker,
    th_type,
    th_quantity,
    th_price,
    th_timestamp,
    DATE_FORMAT(th_timestamp, '%Y-%m-%d %H:%i:%s') as formatted_time
FROM _TRADING_HISTORY 
WHERE th_account_type = 'VIRTUAL'
ORDER BY th_timestamp DESC;

-- 2. 동일 종목 매수/매도 확인
SELECT '=== IMTX 매수/매도 순서 확인 ===' as '';
SELECT 
    th_id,
    th_type,
    th_timestamp,
    th_quantity,
    th_price
FROM _TRADING_HISTORY 
WHERE th_ticker = 'IMTX' AND th_account_type = 'VIRTUAL'
ORDER BY th_timestamp;

-- 3. 모든 거래내역 삭제 (재동기화 준비)
SELECT '=== 거래내역 삭제 중 ===' as '';
DELETE FROM _TRADING_HISTORY WHERE th_account_type = 'VIRTUAL';

-- 4. 삭제 확인
SELECT '=== 삭제 완료 ===' as '';
SELECT COUNT(*) as remaining_count FROM _TRADING_HISTORY WHERE th_account_type = 'VIRTUAL';

-- =========================================
-- 이제 서버가 5분 후 자동으로 재동기화하거나
-- "🔄 KIS 동기화" 버튼을 눌러 수동 동기화
-- =========================================

