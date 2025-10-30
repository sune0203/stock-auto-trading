import mysql from 'mysql2/promise';
import { config } from './config';
import { 
  DetectionResult, 
  PriceTrackHistory, 
  ScannerConfig 
} from './types';

// MySQL 커넥션 풀 생성
const pool = mysql.createPool({
  host: config.db.host,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  port: config.db.port,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// 테이블 초기화
export async function initDatabase() {
  const connection = await pool.getConnection();
  
  try {
    // 감지 결과 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS surge_detections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        detected_at DATETIME NOT NULL,
        score INT NOT NULL,
        reasons TEXT NOT NULL,
        current_price DECIMAL(10, 4) NOT NULL,
        volume BIGINT NOT NULL,
        session VARCHAR(20) NOT NULL,
        technicals JSON NOT NULL,
        sec_event JSON NULL,
        is_tracking BOOLEAN DEFAULT TRUE,
        stopped_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_symbol (symbol),
        INDEX idx_detected_at (detected_at),
        INDEX idx_is_tracking (is_tracking)
      )
    `);

    // 가격 추적 히스토리 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS price_track_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        detection_id INT NOT NULL,
        symbol VARCHAR(10) NOT NULL,
        timestamp DATETIME NOT NULL,
        session VARCHAR(20) NOT NULL,
        price DECIMAL(10, 4) NOT NULL,
        volume BIGINT NOT NULL,
        change_percent DECIMAL(10, 4) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (detection_id) REFERENCES surge_detections(id) ON DELETE CASCADE,
        INDEX idx_detection_id (detection_id),
        INDEX idx_timestamp (timestamp)
      )
    `);

    // 스캐너 설정 테이블
    await connection.query(`
      CREATE TABLE IF NOT EXISTS scanner_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(10) NULL,
        is_active BOOLEAN DEFAULT TRUE,
        min_score INT NOT NULL DEFAULT 50,
        scan_interval INT NOT NULL DEFAULT 5,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_is_active (is_active)
      )
    `);

    // 기본 스캐너 설정 추가
    await connection.query(`
      INSERT IGNORE INTO scanner_configs (id, symbol, is_active, min_score, scan_interval)
      VALUES (1, NULL, TRUE, 50, 5)
    `);

    console.log('✅ 데이터베이스 테이블 초기화 완료');
  } finally {
    connection.release();
  }
}

// 감지 결과 저장
export async function saveDetection(detection: DetectionResult): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO surge_detections 
     (symbol, detected_at, score, reasons, current_price, volume, session, 
      technicals, sec_event, is_tracking)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      detection.symbol,
      detection.detectedAt,
      detection.score,
      JSON.stringify(detection.reasons),
      detection.currentPrice,
      detection.volume,
      detection.session,
      JSON.stringify(detection.technicals),
      detection.secEvent ? JSON.stringify(detection.secEvent) : null,
      detection.isTracking,
    ]
  );
  
  return result.insertId;
}

// 가격 추적 히스토리 저장
export async function savePriceTrack(track: PriceTrackHistory): Promise<void> {
  await pool.query(
    `INSERT INTO price_track_history 
     (detection_id, symbol, timestamp, session, price, volume, change_percent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      track.detectionId,
      track.symbol,
      track.timestamp,
      track.session,
      track.price,
      track.volume,
      track.changePercent,
    ]
  );
}

// 추적 중인 감지 목록 조회
export async function getActiveDetections(): Promise<DetectionResult[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM surge_detections 
     WHERE is_tracking = TRUE 
     ORDER BY detected_at DESC`
  );

  return rows.map(row => ({
    id: row.id,
    symbol: row.symbol,
    detectedAt: new Date(row.detected_at),
    score: row.score,
    reasons: JSON.parse(row.reasons),
    currentPrice: parseFloat(row.current_price),
    volume: parseInt(row.volume),
    session: row.session,
    technicals: JSON.parse(row.technicals),
    secEvent: row.sec_event ? JSON.parse(row.sec_event) : null,
    isTracking: row.is_tracking,
  }));
}

// 특정 감지의 가격 히스토리 조회
export async function getPriceHistory(detectionId: number): Promise<PriceTrackHistory[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM price_track_history 
     WHERE detection_id = ? 
     ORDER BY timestamp ASC`,
    [detectionId]
  );

  return rows.map(row => ({
    id: row.id,
    detectionId: row.detection_id,
    symbol: row.symbol,
    timestamp: new Date(row.timestamp),
    session: row.session,
    price: parseFloat(row.price),
    volume: parseInt(row.volume),
    changePercent: parseFloat(row.change_percent),
  }));
}

// 추적 중지
export async function stopTracking(detectionId: number): Promise<void> {
  await pool.query(
    `UPDATE surge_detections 
     SET is_tracking = FALSE, stopped_at = NOW() 
     WHERE id = ?`,
    [detectionId]
  );
}

// 스캐너 설정 조회
export async function getScannerConfig(): Promise<ScannerConfig | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM scanner_configs WHERE id = 1 LIMIT 1`
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    symbol: row.symbol,
    isActive: row.is_active,
    minScore: row.min_score,
    scanInterval: row.scan_interval,
  };
}

// 스캐너 설정 업데이트
export async function updateScannerConfig(config: Partial<ScannerConfig>): Promise<void> {
  const updates: string[] = [];
  const values: any[] = [];

  if (config.isActive !== undefined) {
    updates.push('is_active = ?');
    values.push(config.isActive);
  }
  if (config.minScore !== undefined) {
    updates.push('min_score = ?');
    values.push(config.minScore);
  }
  if (config.scanInterval !== undefined) {
    updates.push('scan_interval = ?');
    values.push(config.scanInterval);
  }

  if (updates.length > 0) {
    values.push(1); // id = 1
    await pool.query(
      `UPDATE scanner_configs SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
  }
}

// 최근 감지 목록 조회 (페이징)
export async function getRecentDetections(limit: number = 50, offset: number = 0): Promise<DetectionResult[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM surge_detections 
     ORDER BY detected_at DESC 
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  return rows.map(row => ({
    id: row.id,
    symbol: row.symbol,
    detectedAt: new Date(row.detected_at),
    score: row.score,
    reasons: JSON.parse(row.reasons),
    currentPrice: parseFloat(row.current_price),
    volume: parseInt(row.volume),
    session: row.session,
    technicals: JSON.parse(row.technicals),
    secEvent: row.sec_event ? JSON.parse(row.sec_event) : null,
    isTracking: row.is_tracking,
  }));
}

// 데이터베이스 연결 종료
export async function closeDatabase() {
  await pool.end();
  console.log('🔌 데이터베이스 연결 종료');
}

export default pool;

