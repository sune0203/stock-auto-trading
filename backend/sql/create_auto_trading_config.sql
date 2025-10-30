-- 자동매수 설정 테이블
CREATE TABLE IF NOT EXISTS _AUTO_TRADING_CONFIG (
  atc_id INT PRIMARY KEY AUTO_INCREMENT,
  atc_account_type VARCHAR(10) NOT NULL COMMENT '계정 타입 (REAL/VIRTUAL)',
  atc_enabled TINYINT(1) DEFAULT 0 COMMENT '자동매수 활성화 여부',
  atc_bullish_threshold INT DEFAULT 70 COMMENT '긍정 점수 임계값',
  atc_immediate_impact_threshold INT DEFAULT 70 COMMENT '즉시 영향 임계값',
  atc_take_profit_percent DECIMAL(5,2) DEFAULT 5.00 COMMENT '익절 비율 (%)',
  atc_stop_loss_percent DECIMAL(5,2) DEFAULT 3.00 COMMENT '손절 비율 (%)',
  atc_max_investment_per_trade DECIMAL(10,2) DEFAULT 100.00 COMMENT '거래당 최대 투자금 (USD)',
  atc_max_daily_trades INT DEFAULT 10 COMMENT '하루 최대 거래 횟수',
  atc_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atc_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_account (atc_account_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='자동매수 설정';

-- 기본 설정 삽입 (실전투자)
INSERT INTO _AUTO_TRADING_CONFIG (
  atc_account_type, 
  atc_enabled, 
  atc_bullish_threshold, 
  atc_immediate_impact_threshold,
  atc_take_profit_percent,
  atc_stop_loss_percent,
  atc_max_investment_per_trade,
  atc_max_daily_trades
) VALUES (
  'REAL',
  0,
  70,
  70,
  5.00,
  3.00,
  100.00,
  10
) ON DUPLICATE KEY UPDATE atc_account_type = atc_account_type;

-- 기본 설정 삽입 (모의투자)
INSERT INTO _AUTO_TRADING_CONFIG (
  atc_account_type, 
  atc_enabled, 
  atc_bullish_threshold, 
  atc_immediate_impact_threshold,
  atc_take_profit_percent,
  atc_stop_loss_percent,
  atc_max_investment_per_trade,
  atc_max_daily_trades
) VALUES (
  'VIRTUAL',
  0,
  70,
  70,
  5.00,
  3.00,
  100.00,
  10
) ON DUPLICATE KEY UPDATE atc_account_type = atc_account_type;

