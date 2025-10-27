-- =========================================
-- 📊 데이터 확인 및 수정 스크립트
-- =========================================

-- 1️⃣ 현재 거래내역 상태 확인
SELECT '=== 📜 거래내역 현황 ===' as '';
SELECT 
    th_account_type,
    COUNT(*) as count,
    GROUP_CONCAT(DISTINCT th_ticker ORDER BY th_ticker) as tickers
FROM _TRADING_HISTORY 
GROUP BY th_account_type;

-- 2️⃣ 전체 거래내역 확인 (최근 20개)
SELECT '=== 📋 최근 거래내역 ===' as '';
SELECT 
    th_id,
    th_account_type,
    th_ticker,
    th_type,
    th_quantity,
    th_price,
    DATE_FORMAT(th_timestamp, '%Y-%m-%d %H:%i:%s') as timestamp
FROM _TRADING_HISTORY 
ORDER BY th_timestamp DESC
LIMIT 20;

-- 3️⃣ 예약 주문 상태 확인
SELECT '=== ⏰ 예약 주문 현황 ===' as '';
SELECT 
    po_account_type,
    COUNT(*) as count,
    GROUP_CONCAT(DISTINCT po_ticker ORDER BY po_ticker) as tickers
FROM _PENDING_ORDERS 
GROUP BY po_account_type;

-- 4️⃣ 전체 예약 주문 확인
SELECT '=== 📋 전체 예약 주문 ===' as '';
SELECT 
    po_id,
    po_account_type,
    po_ticker,
    po_order_type,
    po_quantity,
    po_status,
    DATE_FORMAT(po_created_at, '%Y-%m-%d %H:%i:%s') as created_at
FROM _PENDING_ORDERS 
ORDER BY po_created_at DESC
LIMIT 20;

-- =========================================
-- 🔧 수정 작업 (필요시 주석 해제)
-- =========================================

-- 5️⃣ 실전투자로 수정해야 할 거래내역이 있다면:
-- 예시: 10월 27일 실전투자로 한 거래를 REAL로 변경
/*
UPDATE _TRADING_HISTORY 
SET th_account_type = 'REAL' 
WHERE DATE(th_timestamp) = '2025-10-27'
AND th_account_type = 'VIRTUAL'
AND th_ticker IN ('BYND', '기타_실전투자_티커');

SELECT CONCAT('✅ 거래내역 ', ROW_COUNT(), '개 수정 완료') as result;
*/

-- 6️⃣ 실전투자로 수정해야 할 예약 주문이 있다면:
/*
UPDATE _PENDING_ORDERS 
SET po_account_type = 'REAL' 
WHERE po_id IN (6, 7, 8)  -- 실전투자 주문 ID
AND po_account_type = 'VIRTUAL';

SELECT CONCAT('✅ 예약 주문 ', ROW_COUNT(), '개 수정 완료') as result;
*/

-- =========================================
-- 7️⃣ 최종 확인
-- =========================================
SELECT '=== ✅ 최종 확인 ===' as '';
SELECT '실전투자' as type, COUNT(*) as trading_count FROM _TRADING_HISTORY WHERE th_account_type = 'REAL'
UNION ALL
SELECT '모의투자' as type, COUNT(*) FROM _TRADING_HISTORY WHERE th_account_type = 'VIRTUAL';

SELECT '실전투자' as type, COUNT(*) as pending_count FROM _PENDING_ORDERS WHERE po_account_type = 'REAL'
UNION ALL
SELECT '모의투자' as type, COUNT(*) FROM _PENDING_ORDERS WHERE po_account_type = 'VIRTUAL';

