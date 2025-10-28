-- 주식 종목 정보 테이블 생성
CREATE TABLE IF NOT EXISTS `_STOCKS` (
  `s_id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '고유 ID',
  `s_ticker` VARCHAR(20) NOT NULL UNIQUE COMMENT '티커 심볼',
  `s_name` VARCHAR(255) NOT NULL COMMENT '영문 종목명',
  `s_name_kr` VARCHAR(255) DEFAULT NULL COMMENT '한글 종목명',
  `s_exchange` VARCHAR(50) DEFAULT NULL COMMENT '거래소 (NASDAQ, NYSE 등)',
  `s_sector` VARCHAR(100) DEFAULT NULL COMMENT '섹터',
  `s_industry` VARCHAR(100) DEFAULT NULL COMMENT '산업',
  `s_created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '등록일',
  `s_updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일',
  INDEX `idx_ticker` (`s_ticker`),
  INDEX `idx_name_kr` (`s_name_kr`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='주식 종목 정보';

-- 샘플 데이터 삽입 (자주 사용되는 종목들)
INSERT IGNORE INTO `_STOCKS` (`s_ticker`, `s_name`, `s_name_kr`, `s_exchange`) VALUES
('AAPL', 'Apple Inc.', '애플', 'NASDAQ'),
('MSFT', 'Microsoft Corporation', '마이크로소프트', 'NASDAQ'),
('GOOGL', 'Alphabet Inc.', '알파벳', 'NASDAQ'),
('AMZN', 'Amazon.com Inc.', '아마존', 'NASDAQ'),
('TSLA', 'Tesla Inc.', '테슬라', 'NASDAQ'),
('META', 'Meta Platforms Inc.', '메타', 'NASDAQ'),
('NVDA', 'NVIDIA Corporation', '엔비디아', 'NASDAQ'),
('NFLX', 'Netflix Inc.', '넷플릭스', 'NASDAQ'),
('BYND', 'Beyond Meat Inc.', '비욘드 미트', 'NASDAQ'),
('STEX', 'Steel Excel Inc.', '스틸 엑셀', 'NASDAQ'),
('APPN', 'Appian Corporation', '앱피안', 'NASDAQ'),
('DVLT', 'Dr. Reddy\'s Laboratories', 'Dr. 레디스', 'NYSE'),
('PLUG', 'Plug Power Inc.', '플러그 파워', 'NASDAQ');

