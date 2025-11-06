-- 계정 타입 컬럼 추가 (실전투자 통일)
-- 실행: mysql -u root -p chart_core < backend/sql/add_account_type_columns.sql

USE chart_core;

-- _POSITIONS 테이블에 계정 타입 컬럼 추가 (없는 경우만)
SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = 'chart_core' 
       AND TABLE_NAME = '_POSITIONS' 
       AND COLUMN_NAME = 'p_account_type') = 0,
    'ALTER TABLE _POSITIONS ADD COLUMN p_account_type VARCHAR(10) DEFAULT ''REAL'' COMMENT ''계정 타입 (실전투자만)'' AFTER p_ticker;',
    'SELECT ''p_account_type column already exists in _POSITIONS'' as message;'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- _PENDING_ORDERS 테이블에 계정 타입 컬럼 추가 (없는 경우만)
SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = 'chart_core' 
       AND TABLE_NAME = '_PENDING_ORDERS' 
       AND COLUMN_NAME = 'po_account_type') = 0,
    'ALTER TABLE _PENDING_ORDERS ADD COLUMN po_account_type VARCHAR(10) DEFAULT ''REAL'' COMMENT ''계정 타입 (실전투자만)'' AFTER po_ticker;',
    'SELECT ''po_account_type column already exists in _PENDING_ORDERS'' as message;'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 기존 데이터를 REAL로 설정
UPDATE _POSITIONS SET p_account_type = 'REAL' WHERE p_account_type IS NULL;
UPDATE _PENDING_ORDERS SET po_account_type = 'REAL' WHERE po_account_type IS NULL;
UPDATE _TRADING_HISTORY SET th_account_type = 'REAL' WHERE th_account_type IS NULL;

-- 인덱스 추가 (성능 최적화) - 없는 경우만
SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
     WHERE TABLE_SCHEMA = 'chart_core' 
       AND TABLE_NAME = '_POSITIONS' 
       AND INDEX_NAME = 'idx_positions_account_type') = 0,
    'CREATE INDEX idx_positions_account_type ON _POSITIONS(p_account_type);',
    'SELECT ''idx_positions_account_type already exists'' as message;'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
     WHERE TABLE_SCHEMA = 'chart_core' 
       AND TABLE_NAME = '_PENDING_ORDERS' 
       AND INDEX_NAME = 'idx_pending_orders_account_type') = 0,
    'CREATE INDEX idx_pending_orders_account_type ON _PENDING_ORDERS(po_account_type);',
    'SELECT ''idx_pending_orders_account_type already exists'' as message;'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
     WHERE TABLE_SCHEMA = 'chart_core' 
       AND TABLE_NAME = '_TRADING_HISTORY' 
       AND INDEX_NAME = 'idx_trading_history_account_type') = 0,
    'CREATE INDEX idx_trading_history_account_type ON _TRADING_HISTORY(th_account_type);',
    'SELECT ''idx_trading_history_account_type already exists'' as message;'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 확인 쿼리
SELECT 
    COLUMN_NAME, 
    DATA_TYPE, 
    IS_NULLABLE, 
    COLUMN_DEFAULT, 
    COLUMN_COMMENT 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'chart_core' 
  AND TABLE_NAME IN ('_POSITIONS', '_PENDING_ORDERS', '_TRADING_HISTORY')
  AND COLUMN_NAME LIKE '%account_type%'
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- 현재 포지션 확인
SELECT p_ticker, p_account_type, p_take_profit_enabled, p_take_profit_percent, p_stop_loss_enabled, p_stop_loss_percent 
FROM _POSITIONS 
WHERE p_take_profit_enabled = TRUE OR p_stop_loss_enabled = TRUE;
