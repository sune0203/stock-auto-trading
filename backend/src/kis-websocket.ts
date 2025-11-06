// KIS API WebSocket 실시간 호가 서비스
import WebSocket from 'ws'
import { kisApiManager } from './kis-api-manager.js'
import crypto from 'crypto'

interface AskingPriceData {
  symb: string          // 종목코드
  zdiv: string          // 소숫점자리수
  xymd: string          // 현지일자
  xhms: string          // 현지시간
  kymd: string          // 한국일자
  khms: string          // 한국시간
  bvol: string          // 매수총잔량
  avol: string          // 매도총잔량
  bdvl: string          // 매수총잔량대비
  advl: string          // 매도총잔량대비
  pbid1: string         // 매수호가1
  pask1: string         // 매도호가1
  vbid1: string         // 매수잔량1
  vask1: string         // 매도잔량1
  dbid1: string         // 매수잔량대비1
  dask1: string         // 매도잔량대비1
}

export class KISWebSocketService {
  private ws: WebSocket | null = null
  private isConnected = false
  private subscribedSymbols = new Set<string>()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 3000
  private onDataCallback: ((data: AskingPriceData) => void) | null = null
  private pingInterval: NodeJS.Timeout | null = null
  private approvalKey: string | null = null
  private pendingResubscribe: Set<string> = new Set() // 🔥 재연결 시 재구독할 종목

  constructor() {}

  // WebSocket 승인키 발급
  private async getApprovalKey(): Promise<string> {
    if (this.approvalKey) return this.approvalKey

    try {
      const account = kisApiManager.getCurrentAccount()
      if (!account) {
        throw new Error('계정이 설정되지 않았습니다')
      }

      const baseUrl = kisApiManager.getBaseUrl()
      const response = await fetch(`${baseUrl}/oauth2/Approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          appkey: account.ka_app_key,
          secretkey: account.ka_app_secret
        })
      })

      const data = await response.json() as { approval_key?: string }
      if (data.approval_key) {
        this.approvalKey = data.approval_key
        console.log('✅ WebSocket 승인키 발급 완료')
        return this.approvalKey
      }

      throw new Error('승인키 발급 실패')
    } catch (error) {
      console.error('❌ WebSocket 승인키 발급 실패:', error)
      throw error
    }
  }

  // WebSocket 연결
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log('⚠️ 이미 WebSocket에 연결되어 있습니다')
      return
    }

    try {
      const account = kisApiManager.getCurrentAccount()
      if (!account) {
        throw new Error('계정이 설정되지 않았습니다')
      }

      // 승인키 발급
      const approvalKey = await this.getApprovalKey()

      // WebSocket URL (실전/모의투자 구분)
      const wsUrl = account.ka_type === 'REAL'
        ? 'ws://ops.koreainvestment.com:21000'
        : 'ws://ops.koreainvestment.com:31000'

      console.log(`🔌 KIS WebSocket 연결 시도... (${account.ka_type})`)

      this.ws = new WebSocket(wsUrl)

      this.ws.on('open', async () => {
        console.log('✅ KIS WebSocket 연결 성공')
        this.isConnected = true
        this.reconnectAttempts = 0
        this.startPing()
        
        // 🔥 재연결 후 자동 재구독
        if (this.pendingResubscribe.size > 0) {
          console.log(`🔄 재연결 후 ${this.pendingResubscribe.size}개 종목 재구독...`)
          for (const symbol of this.pendingResubscribe) {
            await this.subscribe(symbol)
          }
          this.pendingResubscribe.clear()
        }
      })

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString())
      })

      this.ws.on('error', (error) => {
        console.error('❌ KIS WebSocket 에러:', error)
      })

      this.ws.on('close', () => {
        console.log('🔌 KIS WebSocket 연결 종료')
        this.isConnected = false
        this.stopPing()
        
        // 🔥 재구독 목록에 추가 (재연결 시 자동 재구독)
        this.subscribedSymbols.forEach(symbol => {
          this.pendingResubscribe.add(symbol)
        })
        this.subscribedSymbols.clear()
        
        this.attemptReconnect()
      })
    } catch (error) {
      console.error('❌ KIS WebSocket 연결 실패:', error)
      throw error
    }
  }

  // 메시지 처리
  private handleMessage(message: string): void {
    try {
      // 🔥 모든 메시지 로그 (디버깅)
      console.log(`📩 [KIS 원본] ${message.substring(0, 200)}${message.length > 200 ? '...' : ''}`)
      
      // KIS WebSocket 메시지 형식: "0|HEADER|BODY" 또는 "1|HEADER|BODY" 또는 JSON
      
      // JSON 형식인 경우 (PINGPONG 등)
      if (message.startsWith('{')) {
        const jsonData = JSON.parse(message)
        if (jsonData.header?.tr_id === 'PINGPONG') {
          // PINGPONG 응답 (무시)
          return
        }
        console.log('📨 시스템 메시지:', jsonData)
        return
      }

      // 파이프 구분자 형식
      const parts = message.split('|')
      
      if (parts.length < 2) {
        console.warn('⚠️ 잘못된 메시지 형식:', message)
        return
      }

      const [type, header, body] = parts

      // 타입 0: 실시간 데이터, 타입 1: 시스템 메시지
      if (type === '0' && body) {
        const headerData = header.split('^')
        const trId = headerData[0]

        if (trId === 'HDFSASP0') {
          // 실시간 호가 데이터
          const bodyData = body.split('^')
          const askingPriceData: AskingPriceData = {
            symb: bodyData[0] || '',
            zdiv: bodyData[1] || '',
            xymd: bodyData[2] || '',
            xhms: bodyData[3] || '',
            kymd: bodyData[4] || '',
            khms: bodyData[5] || '',
            bvol: bodyData[6] || '',
            avol: bodyData[7] || '',
            bdvl: bodyData[8] || '',
            advl: bodyData[9] || '',
            pbid1: bodyData[10] || '',
            pask1: bodyData[11] || '',
            vbid1: bodyData[12] || '',
            vask1: bodyData[13] || '',
            dbid1: bodyData[14] || '',
            dask1: bodyData[15] || ''
          }

          // 🔥 호가 수신 로그 (디버깅용)
          const symbol = askingPriceData.symb.replace(/^[A-Z]{4}/, '')
          console.log(`📊 [KIS 호가] ${symbol} | 매수: $${askingPriceData.pbid1} (${askingPriceData.vbid1}) | 매도: $${askingPriceData.pask1} (${askingPriceData.vask1})`)

          if (this.onDataCallback) {
            this.onDataCallback(askingPriceData)
          }
        }
      } else if (type === '1') {
        // 시스템 메시지
        console.log('📨 시스템 메시지:', header)
      }
    } catch (error) {
      console.error('❌ 메시지 처리 실패:', error, 'Message:', message)
    }
  }

  // TR Key 생성 (시간대별)
  private generateTrKey(symbol: string): string {
    const now = new Date()
    const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = nyTime.getDay() // 0=일요일, 6=토요일
    const hours = nyTime.getHours()
    const minutes = nyTime.getMinutes()
    const currentMinutes = hours * 60 + minutes

    // 주말은 야간거래 모드
    if (day === 0 || day === 6) {
      return `D${symbol}` // D = 야간거래
    }

    // 거래 시간대별 TR Key 설정
    const preMarketStart = 4 * 60      // 4:00 AM (프리마켓)
    const regularStart = 9 * 60 + 30   // 9:30 AM (정규장)
    const regularEnd = 16 * 60         // 4:00 PM (정규장 종료)
    const afterMarketEnd = 20 * 60     // 8:00 PM (애프터마켓 종료)

    if (currentMinutes >= preMarketStart && currentMinutes < regularStart) {
      // 프리마켓: 야간거래 모드
      return `D${symbol}`
    } else if (currentMinutes >= regularStart && currentMinutes < regularEnd) {
      // 정규장: 야간거래 모드 (KIS 문서상 D로 통일)
      return `D${symbol}`
    } else if (currentMinutes >= regularEnd && currentMinutes < afterMarketEnd) {
      // 애프터마켓: 야간거래 모드
      return `D${symbol}`
    } else {
      // 주간거래: R + 시장구분 + 종목코드 (예: RBAQAAPL)
      return `RBAQ${symbol}` // BAQ = 나스닥 주간거래
    }
  }

  // 종목 구독
  async subscribe(symbol: string): Promise<void> {
    // 연결 대기 (최대 5초)
    let waitCount = 0
    while (!this.isConnected && waitCount < 50) {
      await new Promise(resolve => setTimeout(resolve, 100))
      waitCount++
    }

    if (!this.isConnected || !this.ws) {
      console.error('❌ WebSocket이 연결되지 않았습니다')
      return
    }

    if (this.subscribedSymbols.has(symbol)) {
      console.log(`⚠️ 이미 ${symbol}을 구독 중입니다`)
      return
    }

    try {
      const account = kisApiManager.getCurrentAccount()
      if (!account) {
        throw new Error('계정이 설정되지 않았습니다')
      }

      // TR Key 생성: 시간대별 거래소코드 + 종목코드
      const trKey = this.generateTrKey(symbol)

      // KIS WebSocket 메시지 형식: 단순 JSON 객체 (파이프 없음)
      const message = {
        header: {
          approval_key: this.approvalKey,
          custtype: 'P',
          tr_type: '1',
          'content-type': 'utf-8'
        },
        body: {
          input: {
            tr_id: 'HDFSASP0',
            tr_key: trKey
          }
        }
      }

      const messageStr = JSON.stringify(message)
      console.log(`📤 전송 메시지:`, messageStr)
      this.ws.send(messageStr)
      this.subscribedSymbols.add(symbol)
      console.log(`✅ ${symbol} 실시간 호가 구독 시작 (TR Key: ${trKey})`)
    } catch (error) {
      console.error(`❌ ${symbol} 구독 실패:`, error)
    }
  }

  // 종목 구독 해제
  async unsubscribe(symbol: string): Promise<void> {
    if (!this.isConnected || !this.ws) {
      console.log(`⚠️ WebSocket 연결 끊김 - ${symbol} 구독 해제 건너뜀`)
      this.subscribedSymbols.delete(symbol)
      return
    }

    if (!this.subscribedSymbols.has(symbol)) {
      console.log(`⚠️ ${symbol}을 구독하고 있지 않습니다`)
      return
    }

    try {
      const trKey = `D${symbol}`

      // 🔥 구독 해제 메시지 (tr_type: '2')
      const message = {
        header: {
          approval_key: this.approvalKey,
          custtype: 'P',
          tr_type: '2',
          'content-type': 'utf-8'
        },
        body: {
          input: {
            tr_id: 'HDFSASP0',
            tr_key: trKey
          }
        }
      }

      console.log(`📤 구독 해제 메시지:`, JSON.stringify(message))
      this.ws.send(JSON.stringify(message))
      this.subscribedSymbols.delete(symbol)
      console.log(`✅ ${symbol} 실시간 호가 구독 해제`)
    } catch (error) {
      console.error(`❌ ${symbol} 구독 해제 실패:`, error)
      this.subscribedSymbols.delete(symbol)
    }
  }

  // 데이터 수신 콜백 등록
  onData(callback: (data: AskingPriceData) => void): void {
    this.onDataCallback = callback
  }

  // Ping 전송 (연결 유지)
  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws) {
        // KIS WebSocket PING 메시지: 단순 JSON 객체
        const message = {
          header: {
            approval_key: this.approvalKey,
            custtype: 'P',
            tr_type: '3',
            'content-type': 'utf-8'
          },
          body: {
            input: {
              tr_id: 'PINGPONG',
              tr_key: ''
            }
          }
        }
        
        this.ws.send(JSON.stringify(message))
      }
    }, 30000) // 30초마다 PING
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  // 재연결 시도
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ 최대 재연결 시도 횟수 초과')
      return
    }

    this.reconnectAttempts++
    console.log(`🔄 재연결 시도 ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`)

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('❌ 재연결 실패:', error)
      })
    }, this.reconnectDelay)
  }

  // 연결 종료
  disconnect(): void {
    if (this.ws) { 
      this.stopPing()
      this.ws.close()
      this.ws = null
      this.isConnected = false
      this.subscribedSymbols.clear()
      console.log('✅ KIS WebSocket 연결 종료')
    }
  }

  // 연결 상태 확인
  getConnectionStatus(): boolean {
    return this.isConnected
  }

  // 구독 중인 종목 목록
  getSubscribedSymbols(): string[] {
    return Array.from(this.subscribedSymbols)
  }
}

// 싱글톤 인스턴스
export const kisWebSocketService = new KISWebSocketService()
