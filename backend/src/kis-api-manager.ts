// KIS API 다중 계정 관리자
import axios from 'axios'
import { KISAccount, getDefaultAccount, getAccountById, saveToken, getToken } from './db.js'

interface TokenResponse {
  access_token: string
  access_token_token_expired: string
  token_type: string
  expires_in: number
}

export class KISApiManager {
  private currentAccountType: 'REAL' | 'VIRTUAL' = 'REAL' // 기본값: 실전투자
  private currentAccount: KISAccount | null = null
  private tokenRefreshPromise: Map<number, Promise<string>> = new Map()
  private initialized: boolean = false

  constructor() {
    // 생성자에서는 비동기 작업 하지 않음
  }

  // 초기화 (서버 시작 시 명시적으로 호출)
  async initialize() {
    if (this.initialized) return
    await this.loadDefaultAccount()
    this.initialized = true
  }

  // 기본 계정 로드
  private async loadDefaultAccount() {
    try {
      const account = await getDefaultAccount(this.currentAccountType)
      if (account) {
        this.currentAccount = account
        console.log(`✅ 기본 계정 로드: ${account.ka_name} (${account.ka_type})`)
      } else {
        console.warn(`⚠️ ${this.currentAccountType} 기본 계정이 없습니다`)
      }
    } catch (error) {
      console.error('❌ 기본 계정 로드 실패:', error)
    }
  }

  // 계정 타입 전환 (실전/모의)
  async switchAccountType(type: 'REAL' | 'VIRTUAL') {
    this.currentAccountType = type
    
    // 먼저 기본 계정 시도
    let account = await getDefaultAccount(type)
    
    // 기본 계정이 없으면 해당 타입의 첫 번째 계정 사용
    if (!account) {
      const accounts = await (await import('./db.js')).getAccountsByType(type)
      if (accounts.length > 0) {
        account = accounts[0]
        console.log(`⚠️ 기본 계정 없음, 첫 번째 계정 사용: ${account.ka_name}`)
      }
    }
    
    if (account) {
      this.currentAccount = account
      console.log(`✅ 계정 로드: ${account.ka_name} (${account.ka_type})`)
    } else {
      console.error(`❌ ${type} 타입의 계정이 없습니다`)
      this.currentAccount = null
    }
    
    console.log(`🔄 계정 타입 전환: ${type}`)
  }

  // 특정 계정으로 전환
  async switchAccount(accountId: number) {
    try {
      const account = await getAccountById(accountId)
      if (account) {
        this.currentAccount = account
        this.currentAccountType = account.ka_type
        console.log(`🔄 계정 전환: ${account.ka_name} (${account.ka_type})`)
      } else {
        throw new Error('계정을 찾을 수 없습니다')
      }
    } catch (error) {
      console.error('❌ 계정 전환 실패:', error)
      throw error
    }
  }

  // 현재 계정 정보 반환
  getCurrentAccount(): KISAccount | null {
    return this.currentAccount
  }

  // 현재 계정 타입 반환
  getCurrentAccountType(): 'REAL' | 'VIRTUAL' {
    return this.currentAccountType
  }

  // Base URL 반환
  getBaseUrl(): string {
    if (!this.currentAccount) {
      throw new Error('계정이 설정되지 않았습니다')
    }
    return this.currentAccountType === 'REAL'
      ? 'https://openapi.koreainvestment.com:9443'
      : 'https://openapivts.koreainvestment.com:29443'
  }

  // TR ID 변환 (실전/모의)
  getTrId(baseTrId: string): string {
    if (this.currentAccountType === 'VIRTUAL') {
      // 실전 TR ID를 모의 TR ID로 변환 (첫 글자를 V로)
      if (baseTrId.startsWith('T') || baseTrId.startsWith('C')) {
        return 'V' + baseTrId.substring(1)
      }
    }
    return baseTrId
  }

  // 접근 토큰 발급
  async getAccessToken(forceRefresh: boolean = false): Promise<string> {
    if (!this.currentAccount) {
      await this.loadDefaultAccount()
      if (!this.currentAccount) {
        throw new Error('사용 가능한 계정이 없습니다')
      }
    }

    const accountId = this.currentAccount.ka_id

    // 이미 토큰 발급 중이면 해당 Promise 반환
    if (this.tokenRefreshPromise.has(accountId)) {
      console.log('⏳ 토큰 발급 대기 중...')
      return this.tokenRefreshPromise.get(accountId)!
    }

    // DB에서 토큰 조회 (강제 갱신이 아닌 경우)
    if (!forceRefresh) {
      const cachedToken = await getToken(accountId)
      if (cachedToken) {
        return cachedToken.kt_access_token
      }
    }

    // 새 토큰 발급
    const refreshPromise = this.fetchNewTokenFromKIS()
    this.tokenRefreshPromise.set(accountId, refreshPromise)

    try {
      const token = await refreshPromise
      return token
    } finally {
      this.tokenRefreshPromise.delete(accountId)
    }
  }

  // KIS API에서 새 토큰 발급
  private async fetchNewTokenFromKIS(): Promise<string> {
    if (!this.currentAccount) {
      throw new Error('계정이 설정되지 않았습니다')
    }

    console.log(`🔑 KIS API에 새 토큰 요청 중... (${this.currentAccount.ka_name})`)

    const response = await axios.post<TokenResponse>(
      `${this.getBaseUrl()}/oauth2/tokenP`,
      {
        grant_type: 'client_credentials',
        appkey: this.currentAccount.ka_app_key,
        appsecret: this.currentAccount.ka_app_secret
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    )

    const token = response.data.access_token
    
    // 토큰 만료 시간 파싱
    let expiry: Date
    if (response.data.access_token_token_expired) {
      // KIS API 제공 만료 시간 사용 (예: "2025-10-25 20:12:17")
      expiry = new Date(response.data.access_token_token_expired.replace(' ', 'T') + 'Z')
      console.log(`✓ KIS API 제공 만료 시간: ${response.data.access_token_token_expired}`)
    } else {
      // 24시간 - 1분 여유
      expiry = new Date(Date.now() + (23 * 60 + 59) * 60 * 1000)
    }

    console.log(`✓ 새 토큰 발급 완료 (만료: ${expiry.toISOString()})`)

    // DB에 저장
    await saveToken(this.currentAccount.ka_id, token, expiry)

    return token
  }

  // 토큰 만료 에러 확인
  isTokenExpiredError(error: any): boolean {
    if (!error.response?.data) return false
    const data = error.response.data
    return data.msg_cd === 'EGW00123' || data.msg1?.includes('만료된 token')
  }

  // 토큰 강제 갱신
  async refreshToken(): Promise<string> {
    return this.getAccessToken(true)
  }

  // 잔고 조회
  async getBalance(): Promise<any> {
    if (!this.currentAccount) {
      throw new Error('계정이 설정되지 않았습니다')
    }

    let retryCount = 0
    const maxRetries = 1

    while (retryCount <= maxRetries) {
      try {
        const token = await this.getAccessToken(retryCount > 0)
        
        const response = await axios.get(
          `${this.getBaseUrl()}/uapi/overseas-stock/v1/trading/inquire-balance`,
          {
            params: {
              CANO: this.currentAccount.ka_account_no.substring(0, 8),
              ACNT_PRDT_CD: this.currentAccount.ka_account_no.substring(8),
              OVRS_EXCG_CD: 'NASD',
              TR_CRCY_CD: 'USD',
              CTX_AREA_FK200: '',
              CTX_AREA_NK200: ''
            },
            headers: {
              'Content-Type': 'application/json',
              authorization: `Bearer ${token}`,
              appkey: this.currentAccount.ka_app_key,
              appsecret: this.currentAccount.ka_app_secret,
              tr_id: this.getTrId('TTTS3012R'), // 해외주식 잔고조회 TR ID
              custtype: 'P'
            }
          }
        )

        return response.data
      } catch (error: any) {
        if (this.isTokenExpiredError(error) && retryCount < maxRetries) {
          console.log(`⚠️ 토큰 만료 감지, 재시도 중... (${retryCount + 1}/${maxRetries})`)
          retryCount++
          continue
        }

        console.error(`✗ 잔고 조회 실패:`, error.response?.data || error.message)
        throw error
      }
    }

    throw new Error('잔고 조회 실패: 최대 재시도 횟수 초과')
  }

  // 거래내역 조회 (해외주식 주문체결내역)
  async getTradingHistory(startDate: string, endDate: string): Promise<any> {
    if (!this.currentAccount) {
      throw new Error('계정이 설정되지 않았습니다')
    }

    try {
      const token = await this.getAccessToken()
      
      // 날짜 형식: YYYYMMDD
      const formattedStartDate = startDate.replace(/-/g, '')
      const formattedEndDate = endDate.replace(/-/g, '')
      
      const response = await axios.get(
        `${this.getBaseUrl()}/uapi/overseas-stock/v1/trading/inquire-ccnl`,
        {
          params: {
            CANO: this.currentAccount.ka_account_no.substring(0, 8),
            ACNT_PRDT_CD: this.currentAccount.ka_account_no.substring(8),
            PDNO: '', // 종목코드 (전체 조회, 모의투자는 "" 필수)
            ORD_STRT_DT: formattedStartDate, // 조회시작일자 YYYYMMDD
            ORD_END_DT: formattedEndDate,   // 조회종료일자 YYYYMMDD
            SLL_BUY_DVSN: '00', // 00:전체, 01:매도, 02:매수 (모의투자는 00만 가능)
            CCLD_NCCS_DVSN: '00', // 00:전체, 01:체결, 02:미체결 (모의투자는 00만 가능)
            OVRS_EXCG_CD: '', // 거래소코드 (전체, 모의투자는 "" 필수)
            SORT_SQN: 'DS', // DS:정순, AS:역순
            ORD_DT: '', // 주문일자 (빈값)
            ORD_GNO_BRNO: '', // 주문채번지점번호 (빈값)
            ODNO: '', // 주문번호 (빈값, 주문번호 검색 불가)
            CTX_AREA_NK200: '', // 연속조회키 (최초 조회시 빈값)
            CTX_AREA_FK200: ''  // 연속조회키 (최초 조회시 빈값)
          },
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`,
            appkey: this.currentAccount.ka_app_key,
            appsecret: this.currentAccount.ka_app_secret,
            tr_id: this.getTrId('TTTS3035R'), // ✅ 올바른 TR ID (TTTS3035R/VTTS3035R)
            custtype: 'P'
          }
        }
      )

      const outputCount = response.data.output?.length || 0
      console.log(`📜 KIS 거래내역 조회 성공: ${outputCount}개`)
      
      if (outputCount > 0) {
        console.log(`   샘플: ${response.data.output.slice(0, 3).map((o: any) => o.pdno).join(', ')}`)
      }
      
      return response.data
    } catch (error: any) {
      console.error(`✗ KIS 거래내역 조회 실패:`, error.response?.data || error.message)
      return null
    }
  }

  // 매수 주문
  async buyStock(ticker: string, quantity: number, price?: number): Promise<any> {
    if (!this.currentAccount) {
      throw new Error('계정이 설정되지 않았습니다')
    }

    const token = await this.getAccessToken()
    
    let orderPrice: number = price || 0
    
    if (!orderPrice || orderPrice === 0) {
      console.log(`⚠️ 가격 정보 없음, FMP에서 현재가 조회...`)
      const fmpApi = new (await import('./fmp-api.js')).FMPApi()
      const fetchedPrice = await fmpApi.getCurrentPrice(ticker)
      if (!fetchedPrice) {
        throw new Error(`${ticker} 현재가 조회 실패`)
      }
      orderPrice = fetchedPrice
      console.log(`✓ 주문 가격: $${orderPrice}`)
    }

    // 계정번호 파싱 (8-2 형식, 하이픈 제거)
    const cano = this.currentAccount.ka_account_no.replace(/-/g, '').substring(0, 8)
    const acntPrdtCd = this.currentAccount.ka_account_no.replace(/-/g, '').substring(8)

    // 매수 주문 요청 바디 구성
    const body = {
      CANO: cano,
      ACNT_PRDT_CD: acntPrdtCd,
      OVRS_EXCG_CD: 'NASD',
      PDNO: ticker,
      ORD_QTY: quantity.toString(),
      OVRS_ORD_UNPR: orderPrice.toFixed(2),
      ORD_SVR_DVSN_CD: '0',
      ORD_DVSN: '00' // 00: 지정가 (모의투자는 지정가만 지원)
    }

    // 매수 주문 API 호출
    const response = await axios.post(
      `${this.getBaseUrl()}/uapi/overseas-stock/v1/trading/order`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
          appkey: this.currentAccount.ka_app_key,
          appsecret: this.currentAccount.ka_app_secret,
          tr_id: this.getTrId('TTTT1002U'), // 매수 TR ID (모의: VTTT1002U)
          custtype: 'P'
        }
      }
    )

    console.log(`\n📋 매수 주문 응답:`)
    console.log(JSON.stringify(response.data, null, 2))
    
    if (response.data.rt_cd === '0') {
      console.log(`✅ 매수 주문 성공: ${ticker} x ${quantity}주`)
      return response.data
    } else {
      const errorMsg = response.data.msg1 || '매수 주문 실패'
      console.log(`❌ 매수 주문 실패: ${errorMsg}`)
      throw new Error(errorMsg)
    }
  }

  // 매도 주문
  async sellStock(ticker: string, quantity: number, price?: number): Promise<any> {
    if (!this.currentAccount) {
      throw new Error('계정이 설정되지 않았습니다')
    }

    console.log(`\n🔍 매도 주문 상세 정보:`)
    console.log(`   계정 타입: ${this.currentAccountType}`)
    console.log(`   계정 이름: ${this.currentAccount.ka_name}`)
    console.log(`   계정 번호: ${this.currentAccount.ka_account_no}`)
    console.log(`   Base URL: ${this.getBaseUrl()}`)

    const token = await this.getAccessToken()
    
    let orderPrice: number = price || 0
    
    // 가격이 없으면 FMP에서 현재가 조회
    if (!orderPrice || orderPrice === 0) {
      console.log(`⚠️ 가격 정보 없음, FMP에서 현재가 조회...`)
      const fmpApi = new (await import('./fmp-api.js')).FMPApi()
      const fetchedPrice = await fmpApi.getCurrentPrice(ticker)
      if (!fetchedPrice) {
        throw new Error(`${ticker} 현재가 조회 실패`)
      }
      orderPrice = fetchedPrice
      console.log(`✓ 매도 가격: $${orderPrice}`)
    }

    // 계정번호 파싱 (8-2 형식)
    const cano = this.currentAccount.ka_account_no.replace(/-/g, '').substring(0, 8)
    const acntPrdtCd = this.currentAccount.ka_account_no.replace(/-/g, '').substring(8)
    
    console.log(`   CANO: ${cano}`)
    console.log(`   ACNT_PRDT_CD: ${acntPrdtCd}`)

    // 매도 주문 요청 바디 구성
    const body: any = {
      CANO: cano,
      ACNT_PRDT_CD: acntPrdtCd,
      OVRS_EXCG_CD: 'NASD',
      PDNO: ticker,
      ORD_QTY: quantity.toString(),
      OVRS_ORD_UNPR: orderPrice.toFixed(2),
      ORD_SVR_DVSN_CD: '0',
      ORD_DVSN: '00', // 00: 지정가 (모의투자는 지정가만 지원)
      CTAC_TLNO: '', // 연락전화번호 (선택)
      MGCO_APTM_ODNO: '' // 운용사지정주문번호 (선택)
    }
    
    // 매도일 때만 SLL_TYPE 추가 (모의투자/실전투자 공통)
    body.SLL_TYPE = '00' // 00: 전량매도

    const trId = this.getTrId('TTTT1006U')
    console.log(`   TR ID: ${trId}`)
    console.log(`   요청 바디:`, JSON.stringify(body, null, 2))

    // 매도 주문 API 호출 (매수와 동일한 /trading/order 엔드포인트 사용, TR ID만 다름)
    const response = await axios.post(
      `${this.getBaseUrl()}/uapi/overseas-stock/v1/trading/order`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
          appkey: this.currentAccount.ka_app_key,
          appsecret: this.currentAccount.ka_app_secret,
          tr_id: trId,
          custtype: 'P'
        }
      }
    )

    console.log(`\n📋 매도 주문 응답:`)
    console.log(`   rt_cd: ${response.data.rt_cd}`)
    console.log(`   msg_cd: ${response.data.msg_cd}`)
    console.log(`   msg1: ${response.data.msg1}`)
    console.log(`   전체 응답:`, JSON.stringify(response.data, null, 2))
    
    if (response.data.rt_cd === '0') {
      console.log(`✅ 매도 주문 성공: ${ticker} x ${quantity}주`)
      return response.data
    } else {
      const errorMsg = response.data.msg1 || '매도 주문 실패'
      console.log(`❌ 매도 주문 실패: ${errorMsg}`)
      throw new Error(errorMsg)
    }
  }

  // 결제기준잔고 조회 (USD 예수금)
  async getPaymentBalance(): Promise<{ cash: number; totalAssets: number }> {
    if (!this.currentAccount) {
      throw new Error('계정이 설정되지 않았습니다')
    }

    try {
      const token = await this.getAccessToken()
      
      const params = {
        CANO: this.currentAccount.ka_account_no.substring(0, 8),
        ACNT_PRDT_CD: this.currentAccount.ka_account_no.substring(8),
        OVRS_EXCG_CD: 'NASD',
        WCRC_FRCR_DVSN_CD: '01',
        NATN_CD: '840',
        TR_MKET_CD: '00',
        INQR_DVSN_CD: '00'
      }
      
      const response = await axios.get(
        `${this.getBaseUrl()}/uapi/overseas-stock/v1/trading/inquire-paymt-stdr-balance`,
        {
          params,
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`,
            appkey: this.currentAccount.ka_app_key,
            appsecret: this.currentAccount.ka_app_secret,
            tr_id: this.getTrId('CTRP6504R'),
            custtype: 'P'
          }
        }
      )

      const output2 = response.data.output2 || {}
      const cash = parseFloat(output2.frcr_dncl_amt_2 || '0')
      const totalAssets = parseFloat(output2.tot_asst_amt || '0')
      
      return { cash, totalAssets }
    } catch (error: any) {
      console.error(`✗ 결제기준잔고 조회 실패:`, error.response?.data || error.message)
      return { cash: 0, totalAssets: 0 }
    }
  }

  // 🔥 실시간 시세 조회 (장 마감 후에도 가능)
  // 미국 정규장 오픈 시간 체크 (EST/EDT 09:30 ~ 16:00, Summer Time 자동 적용)
  private isUSMarketOpen(): boolean {
    const now = new Date()
    const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = nyTime.getDay() // 0=일요일, 6=토요일
    const hours = nyTime.getHours()
    const minutes = nyTime.getMinutes()
    const currentMinutes = hours * 60 + minutes

    // 주말 체크
    if (day === 0 || day === 6) {
      return false
    }

    // 정규장: 09:30 ~ 16:00 (EST/EDT, America/New_York 타임존이 자동으로 DST 적용)
    const marketOpen = 9 * 60 + 30 // 9:30 AM = 570분
    const marketClose = 16 * 60    // 4:00 PM = 960분
    
    return currentMinutes >= marketOpen && currentMinutes < marketClose
  }

  async getCurrentPrice(ticker: string): Promise<number | null> {
    // 정규장 외 시간에는 KIS API 미지원
    if (!this.isUSMarketOpen()) {
      return null
    }

    if (!this.currentAccount) {
      throw new Error('계정이 설정되지 않았습니다')
    }

    try {
      const token = await this.getAccessToken()
      
      // 시장 코드 결정 (기본: 나스닥)
      let exchangeCode = 'NAS' // 나스닥
      // TODO: 티커로 시장 자동 판별 (NYS, AMS 등)
      
      const response = await axios.get(
        `${this.getBaseUrl()}/uapi/overseas-price/v1/quotations/price`,
        {
          params: {
            AUTH: '',
            EXCD: exchangeCode,
            SYMB: ticker
          },
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`,
            appkey: this.currentAccount.ka_app_key,
            appsecret: this.currentAccount.ka_app_secret,
            tr_id: 'HHDFS00000300', // 실시간 시세 조회
            custtype: 'P'
          }
        }
      )

      if (response.data && response.data.output) {
        const price = parseFloat(response.data.output.last || '0')
        if (price > 0) {
          return price
        }
      }
      
      return null
    } catch (error: any) {
      // 정규장 중 오류만 로그 출력
      if (this.isUSMarketOpen()) {
        console.error(`❌ KIS 시세 조회 오류: ${ticker}`, error.response?.data?.msg1 || error.message)
      }
      return null
    }
  }

  // 매수가능금액 조회 (실제 USD 예수금)
  async getBuyingPower(ticker: string = 'QQQ', price: number = 1.0): Promise<{ cash: number; maxQuantity: number }> {
    if (!this.currentAccount) {
      throw new Error('계정이 설정되지 않았습니다')
    }

    try {
      const token = await this.getAccessToken()
      
      const response = await axios.get(
        `${this.getBaseUrl()}/uapi/overseas-stock/v1/trading/inquire-psamount`,
        {
          params: {
            CANO: this.currentAccount.ka_account_no.substring(0, 8),
            ACNT_PRDT_CD: this.currentAccount.ka_account_no.substring(8),
            OVRS_EXCG_CD: 'NASD',
            OVRS_ORD_UNPR: price.toFixed(2),
            ITEM_CD: ticker
          },
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`,
            appkey: this.currentAccount.ka_app_key,
            appsecret: this.currentAccount.ka_app_secret,
            tr_id: this.getTrId('TTTS3007R'),
            custtype: 'P'
          }
        }
      )

      const data = response.data
      if (data.rt_cd === '0' && data.output) {
        const cash = parseFloat(data.output.ord_psbl_frcr_amt || '0') // 주문가능외화금액
        const maxQuantity = parseInt(data.output.max_ord_psbl_qty || '0') // 최대주문가능수량
        
        console.log(`💵 매수가능금액: $${cash.toFixed(2)}`)
        console.log(`📊 최대주문가능수량: ${maxQuantity}`)
        
        return { cash, maxQuantity }
      }

      return { cash: 0, maxQuantity: 0 }
    } catch (error: any) {
      console.error('매수가능금액 조회 실패:', error.response?.data || error.message)
      return { cash: 0, maxQuantity: 0 }
    }
  }

  // 주문체결내역 조회 (오늘 날짜 기준 전체 조회)
  async getOrderHistory(days: number = 30): Promise<any> {
    if (!this.currentAccount) {
      throw new Error('계정이 설정되지 않았습니다')
    }

    try {
      const token = await this.getAccessToken()
      
      // 날짜 계산 (현지 시각 기준 - 미국 동부 시간)
      const now = new Date()
      const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
      
      const ordStrtDt = this.formatDate(startDate)
      const ordEndDt = this.formatDate(now)
      
      console.log(`\n📜 주문체결내역 조회: ${ordStrtDt} ~ ${ordEndDt}`)
      
      // 계정번호 파싱
      const cano = this.currentAccount.ka_account_no.replace(/-/g, '').substring(0, 8)
      const acntPrdtCd = this.currentAccount.ka_account_no.replace(/-/g, '').substring(8)
      
      const response = await axios.get(
        `${this.getBaseUrl()}/uapi/overseas-stock/v1/trading/inquire-ccnl`,
        {
          params: {
            CANO: cano,
            ACNT_PRDT_CD: acntPrdtCd,
            PDNO: '', // 전체 종목
            ORD_STRT_DT: ordStrtDt,
            ORD_END_DT: ordEndDt,
            SLL_BUY_DVSN: '00', // 00: 전체, 01: 매도, 02: 매수
            CCLD_NCCS_DVSN: '00', // 00: 전체, 01: 체결, 02: 미체결
            OVRS_EXCG_CD: '', // 전체 거래소
            SORT_SQN: 'DS', // DS: 정순
            ORD_DT: '',
            ORD_GNO_BRNO: '',
            ODNO: '',
            CTX_AREA_NK200: '',
            CTX_AREA_FK200: ''
          },
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`,
            appkey: this.currentAccount.ka_app_key,
            appsecret: this.currentAccount.ka_app_secret,
            tr_id: this.getTrId('TTTS3035R'), // 실전: TTTS3035R, 모의: VTTS3035R
            custtype: 'P'
          }
        }
      )

      if (response.data.rt_cd === '0') {
        const orders = response.data.output || []
        console.log(`✅ 주문내역 ${orders.length}건 조회 완료`)
        
        // 최근 5건만 로그 출력
        orders.slice(0, 5).forEach((order: any, idx: number) => {
          console.log(`  [${idx + 1}] ${order.pdno} | ${order.sll_buy_dvsn_cd === '01' ? '매도' : '매수'} ${order.ft_ord_qty}주 @ $${order.ft_ord_unpr3} | ${order.ord_tmd} | ${order.ccld_nccs_dvsn_name}`)
        })
        
        return response.data
      } else {
        console.error(`❌ 주문내역 조회 실패: ${response.data.msg1}`)
        return { rt_cd: '1', msg1: response.data.msg1, output: [] }
      }
    } catch (error: any) {
      console.error('❌ 주문내역 조회 실패:', error.response?.data || error.message)
      return { rt_cd: '1', msg1: error.message, output: [] }
    }
  }

  // 미체결내역 조회
  async getUnexecutedOrders(): Promise<any> {
    if (!this.currentAccount) {
      throw new Error('계정이 설정되지 않았습니다')
    }

    try {
      const token = await this.getAccessToken()
      
      console.log(`\n📋 미체결내역 조회`)
      
      // 계정번호 파싱
      const cano = this.currentAccount.ka_account_no.replace(/-/g, '').substring(0, 8)
      const acntPrdtCd = this.currentAccount.ka_account_no.replace(/-/g, '').substring(8)
      
      const response = await axios.get(
        `${this.getBaseUrl()}/uapi/overseas-stock/v1/trading/inquire-nccs`,
        {
          params: {
            CANO: cano,
            ACNT_PRDT_CD: acntPrdtCd,
            OVRS_EXCG_CD: 'NASD', // NASD: 미국 전체
            SORT_SQN: 'DS', // DS: 정순
            CTX_AREA_FK200: '',
            CTX_AREA_NK200: ''
          },
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`,
            appkey: this.currentAccount.ka_app_key,
            appsecret: this.currentAccount.ka_app_secret,
            tr_id: this.getTrId('TTTS3018R'), // 실전/모의 동일
            custtype: 'P'
          }
        }
      )

      if (response.data.rt_cd === '0') {
        const orders = response.data.output || []
        console.log(`✅ 미체결 ${orders.length}건 조회 완료`)
        
        // 미체결 주문 상세 로그
        orders.forEach((order: any, idx: number) => {
          console.log(`  [${idx + 1}] ${order.pdno} | ${order.sll_buy_dvsn_cd === '01' ? '매도' : '매수'} ${order.nccs_qty}주 @ $${order.ft_ord_unpr3} | 주문번호: ${order.odno}`)
        })
        
        return response.data
      } else {
        console.error(`❌ 미체결내역 조회 실패: ${response.data.msg1}`)
        return { rt_cd: '1', msg1: response.data.msg1, output: [] }
      }
    } catch (error: any) {
      console.error('❌ 미체결내역 조회 실패:', error.response?.data || error.message)
      return { rt_cd: '1', msg1: error.message, output: [] }
    }
  }

  // 날짜 포맷 헬퍼 (YYYYMMDD)
  private formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }
}

// 싱글톤 인스턴스
export const kisApiManager = new KISApiManager()

