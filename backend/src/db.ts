// MySQL 데이터베이스 연결
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

// 데이터베이스 연결 풀 생성
export const pool = mysql.createPool({
  host: process.env.DB_HOST || '116.122.37.82',
  user: process.env.DB_USER || 'nasdaq',
  password: process.env.DB_PASS || 'core1601!',
  database: process.env.DB_NAME || 'nasdaq',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+09:00' // 한국 시간
})

// 연결 테스트
pool.getConnection()
  .then(connection => {
    console.log('✅ MySQL 연결 성공')
    connection.release()
  })
  .catch(err => {
    console.error('❌ MySQL 연결 실패:', err)
  })

// 뉴스 데이터 타입 (DB 컬럼 매핑)
export interface NewsFromDB {
  n_idx: number
  n_title: string
  n_title_kr?: string
  n_source: string
  n_link: string
  n_summary: string
  n_summary_kr?: string
  n_image?: string
  n_ticker?: string
  n_nasdaq_is: string  // 'Y' or 'N'
  n_gpt_is: string     // 'Y' or 'N'
  n_bullish?: number
  n_bearish?: number
  n_bullish_potential?: number
  n_immediate_impact?: number
  n_time_et?: string
  n_time_kst?: string
  n_save_time?: string
  n_in_time?: string
  n_content_text?: string
}

// _NEWS 테이블에서 뉴스 조회
export async function getNewsFromDB(limit: number = 100): Promise<NewsFromDB[]> {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM _NEWS 
       WHERE n_gpt_is = 'Y' 
       AND n_ticker IS NOT NULL 
       AND n_ticker != ''
       ORDER BY n_in_time DESC 
       LIMIT ?`,
      [limit]
    )
    return rows as NewsFromDB[]
  } catch (error) {
    console.error('❌ DB 뉴스 조회 실패:', error)
    return []
  }
}

// _NEWS 테이블에서 뉴스 페이징 조회
export async function getNewsPaginated(page: number = 1, pageSize: number = 30): Promise<{ news: NewsFromDB[], total: number, totalPages: number }> {
  try {
    // 최근 30개만 조회 (단순화)
    const [rows] = await pool.query(
      `SELECT n_idx, n_title, n_title_kr, n_summary, n_summary_kr, n_link, n_source, n_image, 
              n_ticker, n_symbol, n_time_kst, n_save_time, n_immediate_impact, n_bullish, n_bearish,
              n_bullish_potential, captured_price, trade_volume, n_in_time
       FROM _NEWS 
       WHERE n_gpt_is = 'Y' 
       AND ((n_ticker IS NOT NULL AND n_ticker != '') OR (n_symbol IS NOT NULL AND n_symbol != ''))
       AND (
         EXISTS (SELECT 1 FROM _STOCKS WHERE s_ticker COLLATE utf8mb4_general_ci = n_ticker COLLATE utf8mb4_general_ci)
         OR EXISTS (SELECT 1 FROM _STOCKS WHERE s_ticker COLLATE utf8mb4_general_ci = n_symbol COLLATE utf8mb4_general_ci)
       )
       ORDER BY n_in_time DESC 
       LIMIT 30`
    )
    
    const total = (rows as any[]).length
    
    return {
      news: rows as NewsFromDB[],
      total,
      totalPages: 1
    }
  } catch (error) {
    console.error('❌ DB 뉴스 페이징 조회 실패:', error)
    return { news: [], total: 0, totalPages: 0 }
  }
}

// 실시간 뉴스 감지 (폴링 방식)
export async function watchNewsDB(callback: (news: NewsFromDB[]) => void, interval: number = 3000) {
  let lastCheckTime = new Date()
  
  setInterval(async () => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM _NEWS 
         WHERE n_gpt_is = 'Y' 
         AND n_ticker IS NOT NULL 
         AND n_ticker != ''
         AND n_in_time > ? 
         ORDER BY n_in_time DESC`,
        [lastCheckTime]
      )
      
      const newNews = rows as NewsFromDB[]
      
      if (newNews.length > 0) {
        console.log(`📰 신규 뉴스 ${newNews.length}개 감지`)
        lastCheckTime = new Date()
        callback(newNews)
      }
    } catch (error) {
      console.error('❌ DB 뉴스 감지 오류:', error)
    }
  }, interval)
  
  console.log(`👀 DB 뉴스 감지 시작 (${interval}ms 간격)`)
}

// 매매 기록 인터페이스
export interface TradingRecord {
  th_ticker: string
  th_account_type: 'REAL' // 실전투자만 지원
  th_type: 'BUY' | 'SELL'
  th_price: number
  th_quantity: number
  th_amount: number
  th_order_no?: string // 🔥 KIS 주문번호
  th_execution_time?: string // 🔥 실제 체결시간
  th_status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  th_reason?: string
  th_news_idx?: number
  th_profit_loss?: number
  th_profit_loss_percent?: number
  th_timestamp?: Date
}

// 매매 기록 저장
export async function saveTradingRecord(record: TradingRecord): Promise<number> {
  try {
    const [result] = await pool.query(
      `INSERT INTO _TRADING_HISTORY 
       (th_account_type, th_ticker, th_type, th_price, th_quantity, th_amount, 
        th_order_no, th_execution_time, th_status, th_profit_loss, th_profit_loss_percent, th_reason, th_timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.th_account_type, // 🆕 계정 타입 추가!
        record.th_ticker,
        record.th_type,
        record.th_price,
        record.th_quantity,
        record.th_amount,
        record.th_order_no || null, // 🔥 KIS 주문번호
        record.th_execution_time || null, // 🔥 실제 체결시간
        record.th_status || 'COMPLETED',
        record.th_profit_loss || null,
        record.th_profit_loss_percent || null,
        record.th_reason || null,
        record.th_timestamp || new Date()
      ]
    )
    const insertId = (result as any).insertId
    console.log(`💾 매매 기록 저장: [${record.th_account_type}] ${record.th_type} ${record.th_ticker} x${record.th_quantity} @ $${record.th_price} (주문번호: ${record.th_order_no || 'N/A'})`)
    return insertId
  } catch (error) {
    console.error('❌ 매매 기록 저장 실패:', error)
    throw error
  }
}

// 예약 주문 인터페이스
export interface PendingOrder {
  po_id?: number
  po_ticker: string
  po_account_type: 'REAL' // 실전투자만 지원
  po_order_type: 'buy' | 'sell'
  po_quantity: number
  po_price_type: 'market' | 'limit'
  po_limit_price?: number
  po_reservation_type: 'opening' | 'current'
  po_take_profit_percent?: number
  po_stop_loss_percent?: number
  po_reason?: string
  po_news_title?: string
  po_status: 'pending' | 'executed' | 'cancelled' | 'failed'
  po_created_at?: string
  po_scheduled_at?: string
  po_executed_at?: string
  po_error_message?: string
}

// 포지션 인터페이스
export interface DBPosition {
  p_id?: number
  p_ticker: string
  p_account_type: 'REAL' // 실전투자만 지원
  p_quantity: number
  p_buy_price: number
  p_current_price: number
  p_profit_loss: number
  p_profit_loss_percent: number
  p_take_profit_enabled: boolean
  p_take_profit_percent?: number
  p_stop_loss_enabled: boolean
  p_stop_loss_percent?: number
  p_buy_time?: string
  p_updated_at?: string
}

// 예약 주문 저장
export async function savePendingOrder(order: PendingOrder): Promise<number> {
  try {
    const [result] = await pool.query(
      `INSERT INTO _PENDING_ORDERS (
        po_ticker, po_account_type, po_order_type, po_quantity, po_price_type, po_limit_price,
        po_reservation_type, po_take_profit_percent, po_stop_loss_percent,
        po_reason, po_news_title, po_status, po_scheduled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.po_ticker,
        order.po_account_type, // 🆕 계정 타입 추가!
        order.po_order_type,
        order.po_quantity,
        order.po_price_type,
        order.po_limit_price || null,
        order.po_reservation_type,
        order.po_take_profit_percent || null,
        order.po_stop_loss_percent || null,
        order.po_reason || null,
        order.po_news_title || null,
        order.po_status,
        order.po_scheduled_at || null
      ]
    )
    const insertId = (result as any).insertId
    console.log(`✅ 예약 주문 저장: ${order.po_ticker} (ID: ${insertId}) [${order.po_account_type}]`)
    return insertId
  } catch (error) {
    console.error('❌ 예약 주문 저장 실패:', error)
    throw error
  }
}

// 예약 주문 조회 (pending 상태만)
export async function getPendingOrders(accountType: 'REAL' = 'REAL'): Promise<PendingOrder[]> {
  try {
    let query = `SELECT * FROM _PENDING_ORDERS 
       WHERE po_status = 'pending' 
       AND (po_scheduled_at IS NULL OR po_scheduled_at <= NOW())`
    const params: any[] = []
    
    if (accountType) {
      query += ` AND po_account_type = ?`
      params.push(accountType)
    }
    
    query += ` ORDER BY po_created_at ASC`
    
    const [rows] = await pool.query(query, params)
    return rows as PendingOrder[]
  } catch (error) {
    console.error('❌ 예약 주문 조회 실패:', error)
    return []
  }
}

// 예약 주문 상태 업데이트
export async function updatePendingOrderStatus(
  orderId: number,
  status: 'executed' | 'cancelled' | 'failed',
  errorMessage?: string
): Promise<void> {
  try {
    await pool.query(
      `UPDATE _PENDING_ORDERS 
       SET po_status = ?, po_executed_at = NOW(), po_error_message = ?
       WHERE po_id = ?`,
      [status, errorMessage || null, orderId]
    )
    console.log(`✅ 예약 주문 상태 업데이트: ${orderId} -> ${status}`)
  } catch (error) {
    console.error('❌ 예약 주문 상태 업데이트 실패:', error)
    throw error
  }
}

// 포지션 저장/업데이트
export async function saveDBPosition(position: DBPosition): Promise<number> {
  try {
    // 기존 포지션 확인 (계정 타입별로)
    const [existing] = await pool.query(
      `SELECT p_id, p_quantity, p_buy_price FROM _POSITIONS 
       WHERE p_ticker = ? AND p_account_type = ?`,
      [position.p_ticker, position.p_account_type]
    )
    
    if ((existing as any[]).length > 0) {
      // 기존 포지션 업데이트 (수량 합산, 평균 매입가 계산)
      const existingPos = (existing as any[])[0]
      const newQuantity = existingPos.p_quantity + position.p_quantity
      const avgBuyPrice = ((existingPos.p_quantity * existingPos.p_buy_price) + (position.p_quantity * position.p_buy_price)) / newQuantity
      
      await pool.query(
        `UPDATE _POSITIONS 
         SET p_quantity = ?, p_buy_price = ?, p_current_price = ?,
             p_take_profit_enabled = ?, p_take_profit_percent = ?,
             p_stop_loss_enabled = ?, p_stop_loss_percent = ?
         WHERE p_ticker = ? AND p_account_type = ?`,
        [
          newQuantity,
          avgBuyPrice,
          position.p_current_price,
          position.p_take_profit_enabled,
          position.p_take_profit_percent || null,
          position.p_stop_loss_enabled,
          position.p_stop_loss_percent || null,
          position.p_ticker,
          position.p_account_type
        ]
      )
      console.log(`✅ 포지션 업데이트: ${position.p_ticker} (수량: ${newQuantity})`)
      return existingPos.p_id
    } else {
      // 신규 포지션 추가
      const [result] = await pool.query(
        `INSERT INTO _POSITIONS (
          p_ticker, p_account_type, p_quantity, p_buy_price, p_current_price,
          p_profit_loss, p_profit_loss_percent,
          p_take_profit_enabled, p_take_profit_percent,
          p_stop_loss_enabled, p_stop_loss_percent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          position.p_ticker,
          position.p_account_type,
          position.p_quantity,
          position.p_buy_price,
          position.p_current_price,
          position.p_profit_loss,
          position.p_profit_loss_percent,
          position.p_take_profit_enabled,
          position.p_take_profit_percent || null,
          position.p_stop_loss_enabled,
          position.p_stop_loss_percent || null
        ]
      )
      const insertId = (result as any).insertId
      console.log(`✅ 신규 포지션 저장: ${position.p_ticker} (ID: ${insertId})`)
      return insertId
    }
  } catch (error) {
    console.error('❌ 포지션 저장 실패:', error)
    throw error
  }
}

// 포지션 조회 (계정 타입별)
export async function getDBPositions(accountType: 'REAL' = 'REAL'): Promise<DBPosition[]> {
  try {
    let query = `SELECT * FROM _POSITIONS`
    const params: any[] = []
    
    if (accountType) {
      query += ` WHERE p_account_type = ?`
      params.push(accountType)
    }
    
    query += ` ORDER BY p_buy_time DESC`
    
    const [rows] = await pool.query(query, params)
    const positions = rows as DBPosition[]
    console.log(`📋 포지션 조회 (DB): ${positions.length}개 (계정 타입 필터 비활성화됨)`)
    return positions
  } catch (error) {
    console.error('❌ 포지션 조회 실패:', error)
    return []
  }
}

// 포지션 현재가 업데이트 (계정 타입별)
export async function updatePositionPrice(ticker: string, currentPrice: number, accountType: 'REAL' = 'REAL'): Promise<void> {
  try {
    let query = `UPDATE _POSITIONS 
       SET p_current_price = ?,
           p_profit_loss = (p_current_price - p_buy_price) * p_quantity,
           p_profit_loss_percent = ((p_current_price - p_buy_price) / p_buy_price) * 100
       WHERE p_ticker = ?`
    const params: any[] = [currentPrice, ticker]
    
    if (accountType) {
      query += ` AND p_account_type = ?`
      params.push(accountType)
    }
    
    await pool.query(query, params)
  } catch (error) {
    console.error(`❌ 포지션 가격 업데이트 실패 (${ticker}):`, error)
  }
}

// 포지션 수량 감소 (부분 매도) - 계정 타입별
export async function reducePositionQuantity(ticker: string, quantity: number, accountType: 'REAL' = 'REAL'): Promise<void> {
  try {
    const [rows] = await pool.query(
      `SELECT p_quantity FROM _POSITIONS WHERE p_ticker = ? AND p_account_type = ?`,
      [ticker, accountType]
    )
    
    if ((rows as any[]).length === 0) {
      throw new Error(`포지션 없음: ${ticker}`)
    }
    
    const currentQty = (rows as any[])[0].p_quantity
    const newQty = currentQty - quantity
    
    if (newQty <= 0) {
      // 전량 매도 - 포지션 삭제
      await deleteDBPosition(ticker, accountType)
    } else {
      // 부분 매도 - 수량 감소
      await pool.query(
        `UPDATE _POSITIONS SET p_quantity = ? WHERE p_ticker = ? AND p_account_type = ?`,
        [newQty, ticker, accountType]
      )
      console.log(`✅ 포지션 수량 감소: ${ticker} (${currentQty} -> ${newQty})`)
    }
  } catch (error) {
    console.error('❌ 포지션 수량 감소 실패:', error)
    throw error
  }
}

// 포지션 삭제 (전량 매도 시) - 계정 타입별
export async function deleteDBPosition(ticker: string, accountType: 'REAL' = 'REAL'): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM _POSITIONS WHERE p_ticker = ? AND p_account_type = ?`,
      [ticker, accountType]
    )
    console.log(`✅ 포지션 삭제: ${ticker}`)
  } catch (error) {
    console.error('❌ 포지션 삭제 실패:', error)
    throw error
  }
}

// 익절/손절 감시 대상 포지션 조회 (계정 타입별)
export async function getMonitoredPositions(accountType: 'REAL' = 'REAL'): Promise<DBPosition[]> {
  try {
    let query = `SELECT * FROM _POSITIONS 
       WHERE (p_take_profit_enabled = TRUE OR p_stop_loss_enabled = TRUE)`
    const params: any[] = []
    
    if (accountType) {
      query += ` AND p_account_type = ?`
      params.push(accountType)
    }
    
    const [rows] = await pool.query(query, params)
    return rows as DBPosition[]
  } catch (error) {
    console.error('❌ 감시 포지션 조회 실패:', error)
    return []
  }
}

// 매매 기록 조회 (계정 타입별)
export async function getTradingHistory(limit: number = 100, accountType: 'REAL' = 'REAL'): Promise<any[]> {
  try {
    let query = `SELECT * FROM _TRADING_HISTORY`
    const params: any[] = []
    
    if (accountType) {
      query += ` WHERE th_account_type = ?`
      params.push(accountType)
      console.log(`🔍 거래내역 조회 SQL: ${query} [${accountType}]`)
    } else {
      console.log(`🔍 거래내역 조회 SQL: ${query} (필터 없음)`)
    }
    
    query += ` ORDER BY th_timestamp DESC LIMIT ?`
    params.push(limit)
    
    const [rows] = await pool.query(query, params)
    console.log(`📊 DB 조회 결과: ${(rows as any[]).length}개`)
    
    // 결과 샘플 로그 (최대 3개)
    if ((rows as any[]).length > 0) {
      const sample = (rows as any[]).slice(0, 3)
      console.log(`   샘플:`, sample.map(r => `${r.th_ticker}(${r.th_account_type})`).join(', '))
    }
    
    return rows as any[]
  } catch (error) {
    console.error('❌ 매매 기록 조회 실패:', error)
    return []
  }
}

// 매매 기록 업데이트
export async function updateTradingRecord(
  recordId: number, 
  updates: Partial<TradingRecord>
): Promise<void> {
  try {
    const fields: string[] = []
    const values: any[] = []
    
    Object.entries(updates).forEach(([key, value]) => {
      fields.push(`${key} = ?`)
      values.push(value)
    })
    
    values.push(recordId)
    
    await pool.query(
      `UPDATE _TRADING_HISTORY SET ${fields.join(', ')} WHERE t_idx = ?`,
      values
    )
    console.log(`✅ 매매 기록 업데이트: ID ${recordId}`)
  } catch (error) {
    console.error('❌ 매매 기록 업데이트 실패:', error)
    throw error
  }
}

// ==================== KIS 계정 관리 ====================

export interface KISAccount {
  ka_id: number
  ka_type: 'REAL' | 'VIRTUAL'
  ka_name: string
  ka_account_no: string
  ka_account_password: string
  ka_app_key: string
  ka_app_secret: string
  ka_is_active: boolean
  ka_is_default: boolean
  ka_created_at: Date
  ka_updated_at: Date
}

export interface KISToken {
  kt_id: number
  kt_account_id: number
  kt_access_token: string
  kt_token_type: string
  kt_expires_at: Date
  kt_created_at: Date
  kt_updated_at: Date
}

// 모든 계정 조회
export async function getAllAccounts(): Promise<KISAccount[]> {
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM _KIS_ACCOUNTS WHERE ka_is_active = TRUE ORDER BY ka_type, ka_is_default DESC'
    )
    return rows
  } catch (error) {
    console.error('❌ 계정 조회 실패:', error)
    return []
  }
}

// 특정 타입의 계정 조회
export async function getAccountsByType(type: 'REAL' | 'VIRTUAL'): Promise<KISAccount[]> {
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM _KIS_ACCOUNTS WHERE ka_type = ? AND ka_is_active = TRUE ORDER BY ka_is_default DESC',
      [type]
    )
    return rows
  } catch (error) {
    console.error('❌ 계정 조회 실패:', error)
    return []
  }
}

// 기본 계정 조회
export async function getDefaultAccount(type: 'REAL' | 'VIRTUAL'): Promise<KISAccount | null> {
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM _KIS_ACCOUNTS WHERE ka_type = ? AND ka_is_default = TRUE AND ka_is_active = TRUE LIMIT 1',
      [type]
    )
    return rows.length > 0 ? rows[0] : null
  } catch (error) {
    console.error('❌ 기본 계정 조회 실패:', error)
    return null
  }
}

// 계정 ID로 조회
export async function getAccountById(accountId: number): Promise<KISAccount | null> {
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM _KIS_ACCOUNTS WHERE ka_id = ?',
      [accountId]
    )
    return rows.length > 0 ? rows[0] : null
  } catch (error) {
    console.error('❌ 계정 조회 실패:', error)
    return null
  }
}

// 계정 추가
export async function addAccount(account: Omit<KISAccount, 'ka_id' | 'ka_created_at' | 'ka_updated_at'>): Promise<number> {
  try {
    const [result] = await pool.query<any>(
      `INSERT INTO _KIS_ACCOUNTS 
       (ka_type, ka_name, ka_account_no, ka_account_password, ka_app_key, ka_app_secret, ka_is_active, ka_is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        account.ka_type,
        account.ka_name,
        account.ka_account_no,
        account.ka_account_password,
        account.ka_app_key,
        account.ka_app_secret,
        account.ka_is_active,
        account.ka_is_default
      ]
    )
    console.log(`✅ 계정 추가: ${account.ka_name}`)
    return result.insertId
  } catch (error) {
    console.error('❌ 계정 추가 실패:', error)
    throw error
  }
}

// 기본 계정 설정
export async function setDefaultAccount(accountId: number): Promise<void> {
  try {
    // 해당 계정의 타입 조회
    const account = await getAccountById(accountId)
    if (!account) {
      throw new Error('계정을 찾을 수 없습니다')
    }

    // 같은 타입의 모든 계정을 기본이 아닌 것으로 설정
    await pool.query(
      'UPDATE _KIS_ACCOUNTS SET ka_is_default = FALSE WHERE ka_type = ?',
      [account.ka_type]
    )

    // 선택한 계정을 기본으로 설정
    await pool.query(
      'UPDATE _KIS_ACCOUNTS SET ka_is_default = TRUE WHERE ka_id = ?',
      [accountId]
    )

    console.log(`✅ 기본 계정 설정: ${account.ka_name}`)
  } catch (error) {
    console.error('❌ 기본 계정 설정 실패:', error)
    throw error
  }
}

// 토큰 저장
export async function saveToken(accountId: number, accessToken: string, expiresAt: Date): Promise<void> {
  try {
    // 기존 토큰 삭제
    await pool.query('DELETE FROM _KIS_TOKENS WHERE kt_account_id = ?', [accountId])

    // 새 토큰 저장
    await pool.query(
      `INSERT INTO _KIS_TOKENS (kt_account_id, kt_access_token, kt_expires_at)
       VALUES (?, ?, ?)`,
      [accountId, accessToken, expiresAt]
    )

    console.log(`✅ 토큰 저장: 계정 ID ${accountId}`)
  } catch (error) {
    console.error('❌ 토큰 저장 실패:', error)
    throw error
  }
}

// 토큰 조회
export async function getToken(accountId: number): Promise<KISToken | null> {
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM _KIS_TOKENS WHERE kt_account_id = ? AND kt_expires_at > NOW() ORDER BY kt_created_at DESC LIMIT 1',
      [accountId]
    )
    return rows.length > 0 ? rows[0] : null
  } catch (error) {
    console.error('❌ 토큰 조회 실패:', error)
    return null
  }
}

// 토큰 삭제
export async function deleteToken(accountId: number): Promise<void> {
  try {
    await pool.query('DELETE FROM _KIS_TOKENS WHERE kt_account_id = ?', [accountId])
    console.log(`✅ 토큰 삭제: 계정 ID ${accountId}`)
  } catch (error) {
    console.error('❌ 토큰 삭제 실패:', error)
    throw error
  }
}

// ==================== 자동매수 설정 ====================

export interface AutoTradingConfig {
  atc_id: number
  atc_account_type: 'REAL' | 'VIRTUAL'
  atc_enabled: boolean
  atc_bullish_threshold: number
  atc_immediate_impact_threshold: number
  atc_take_profit_percent: number
  atc_stop_loss_percent: number
  atc_max_investment_per_trade: number
  atc_max_daily_trades: number
  atc_created_at: Date
  atc_updated_at: Date
}

// 자동매수 설정 조회
export async function getAutoTradingConfig(accountType: 'REAL' | 'VIRTUAL'): Promise<AutoTradingConfig | null> {
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM _AUTO_TRADING_CONFIG WHERE atc_account_type = ?',
      [accountType]
    )
    return rows.length > 0 ? rows[0] : null
  } catch (error) {
    console.error('❌ 자동매수 설정 조회 실패:', error)
    return null
  }
}

// 자동매수 설정 저장/업데이트
export async function saveAutoTradingConfig(config: Partial<AutoTradingConfig>): Promise<boolean> {
  try {
    const accountType = config.atc_account_type || 'REAL'
    
    await pool.query(
      `INSERT INTO _AUTO_TRADING_CONFIG (
        atc_account_type, 
        atc_enabled, 
        atc_bullish_threshold, 
        atc_immediate_impact_threshold,
        atc_take_profit_percent,
        atc_stop_loss_percent,
        atc_max_investment_per_trade,
        atc_max_daily_trades
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        atc_enabled = VALUES(atc_enabled),
        atc_bullish_threshold = VALUES(atc_bullish_threshold),
        atc_immediate_impact_threshold = VALUES(atc_immediate_impact_threshold),
        atc_take_profit_percent = VALUES(atc_take_profit_percent),
        atc_stop_loss_percent = VALUES(atc_stop_loss_percent),
        atc_max_investment_per_trade = VALUES(atc_max_investment_per_trade),
        atc_max_daily_trades = VALUES(atc_max_daily_trades),
        atc_updated_at = CURRENT_TIMESTAMP`,
      [
        accountType,
        config.atc_enabled ? 1 : 0,
        config.atc_bullish_threshold || 70,
        config.atc_immediate_impact_threshold || 70,
        config.atc_take_profit_percent || 5.00,
        config.atc_stop_loss_percent || 3.00,
        config.atc_max_investment_per_trade || 100.00,
        config.atc_max_daily_trades || 10
      ]
    )
    
    console.log(`✅ 자동매수 설정 저장: ${accountType}`)
    return true
  } catch (error) {
    console.error('❌ 자동매수 설정 저장 실패:', error)
    return false
  }
}

// 자동매수 ON/OFF 토글
export async function toggleAutoTrading(accountType: 'REAL' | 'VIRTUAL', enabled: boolean): Promise<boolean> {
  try {
    await pool.query(
      'UPDATE _AUTO_TRADING_CONFIG SET atc_enabled = ?, atc_updated_at = CURRENT_TIMESTAMP WHERE atc_account_type = ?',
      [enabled ? 1 : 0, accountType]
    )
    console.log(`✅ 자동매수 ${enabled ? 'ON' : 'OFF'}: ${accountType}`)
    return true
  } catch (error) {
    console.error('❌ 자동매수 토글 실패:', error)
    return false
  }
}

