-- =========================================
-- 🚨 긴급 DB 확인 스크립트
-- =========================================

-- 1. 테이블이 존재하는가?
SHOW TABLES LIKE '_TRADING_HISTORY';

-- 2. 테이블 구조 확인
DESCRIBE _TRADING_HISTORY;

-- 3. 전체 데이터 개수
SELECT '=== 전체 거래내역 개수 ===' as '';
SELECT COUNT(*) as total_count FROM _TRADING_HISTORY;

-- 4. 전체 데이터 조회 (모든 account_type)
SELECT '=== 전체 거래내역 (필터 없음) ===' as '';
SELECT * FROM _TRADING_HISTORY ORDER BY th_timestamp DESC LIMIT 20;

-- 5. 계정 타입별 개수
SELECT '=== 계정 타입별 개수 ===' as '';
SELECT 
    COALESCE(th_account_type, 'NULL') as account_type,
    COUNT(*) as count
FROM _TRADING_HISTORY 
GROUP BY th_account_type;

-- 6. 예약 주문도 확인
SELECT '=== 예약 주문 개수 ===' as '';
SELECT COUNT(*) as total_count FROM _PENDING_ORDERS;

SELECT '=== 예약 주문 내역 ===' as '';
SELECT * FROM _PENDING_ORDERS ORDER BY po_created_at DESC LIMIT 10;

-- =========================================
-- 결과 해석
-- =========================================
/*
만약 COUNT(*) = 0 이면:
  → 거래를 한 번도 하지 않았거나, 데이터가 저장되지 않음
  → 해결: 새로운 거래를 실행하여 데이터 생성

만약 COUNT(*) > 0 이면:
  → 데이터는 있지만 th_account_type이 잘못됨
  → 해결: UPDATE로 수정
*/

