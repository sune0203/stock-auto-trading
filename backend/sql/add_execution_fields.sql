-- H0GSCNI0 API 체결 정보 필드 추가
-- 실행: mysql -u root -p chart_core < backend/sql/add_execution_fields.sql

USE chart_core;

-- _TRADING_HISTORY 테이블에 체결 정보 필드 추가
ALTER TABLE _TRADING_HISTORY 
ADD COLUMN th_order_no VARCHAR(50) COMMENT 'KIS 주문번호' AFTER th_amount,
ADD COLUMN th_execution_time VARCHAR(20) COMMENT '실제 체결시간' AFTER th_order_no,
ADD COLUMN th_status VARCHAR(20) DEFAULT 'COMPLETED' COMMENT '주문 상태' AFTER th_execution_time;

-- 기존 레코드의 상태를 COMPLETED로 설정
UPDATE _TRADING_HISTORY SET th_status = 'COMPLETED' WHERE th_status IS NULL;

-- 인덱스 추가 (성능 최적화)
CREATE INDEX idx_trading_history_order_no ON _TRADING_HISTORY(th_order_no);
CREATE INDEX idx_trading_history_execution_time ON _TRADING_HISTORY(th_execution_time);
CREATE INDEX idx_trading_history_status ON _TRADING_HISTORY(th_status);

-- 확인 쿼리
SELECT 
    COLUMN_NAME, 
    DATA_TYPE, 
    IS_NULLABLE, 
    COLUMN_DEFAULT, 
    COLUMN_COMMENT 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'chart_core' 
  AND TABLE_NAME = '_TRADING_HISTORY' 
ORDER BY ORDINAL_POSITION;

DESCRIBE _TRADING_HISTORY;
