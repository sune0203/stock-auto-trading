// 나스닥 전체 심볼 다운로드 스크립트
import axios from 'axios'
import fs from 'fs'
import path from 'path'

const FMP_API_KEY = 'Nz122fIiH3KWDx8UVBdQFL8a5NU9lRhc'
const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3'

interface NasdaqSymbol {
  symbol: string
  name: string
  price: number
  exchange: string
  exchangeShortName: string
  type: string
}

interface LocalSymbolDB {
  symbol: string
  name: string
  nameLower: string // 검색 최적화용
  nameWords: string[] // 단어별 검색용
  exchange: string
  type: string
  lastUpdated: string
}

async function downloadNasdaqSymbols() {
  try {
    console.log('🔍 나스닥 전체 심볼 다운로드 시작...')
    console.log('📡 API: FMP Available Traded List (실제 거래 종목만)')
    
    // Available Traded List API - 실제 거래되는 주식만
    const url = `${FMP_BASE_URL}/available-traded/list?apikey=${FMP_API_KEY}`
    console.log(`  → API 호출 중...`)
    
    const response = await axios.get(url, { timeout: 60000 })
    const allSymbols = response.data || []
    
    console.log(`📊 전체 거래 가능 심볼: ${allSymbols.length}개`)
    
    // 나스닥 + USD 통화만 필터링
    const nasdaqSymbols: NasdaqSymbol[] = allSymbols.filter((item: any) => {
      const exchange = item.exchangeShortName || item.exchange || ''
      
      // NASDAQ 거래소만
      const isNasdaq = exchange === 'NASDAQ' || 
                       exchange === 'NMS' || 
                       exchange === 'NGM' || 
                       exchange === 'NCM'
      
      // stock 타입만 (ETF, FUND 제외)
      const isStock = !item.type || item.type.toLowerCase() === 'stock' || item.type.toLowerCase() === 'common stock'
      
      return isNasdaq && isStock
    })
    
    console.log(`✓ 나스닥 주식 심볼: ${nasdaqSymbols.length}개`)
    
    // 중복 제거 (같은 심볼이 여러 번 나올 수 있음)
    const uniqueSymbols = new Map<string, NasdaqSymbol>()
    nasdaqSymbols.forEach(item => {
      if (!uniqueSymbols.has(item.symbol)) {
        uniqueSymbols.set(item.symbol, item)
      }
    })
    
    const finalSymbols = Array.from(uniqueSymbols.values())
    console.log(`✓ 중복 제거 후: ${finalSymbols.length}개`)
    
    // 로컬 DB 형식으로 변환
    const localDB: LocalSymbolDB[] = finalSymbols.map(item => {
      const nameLower = item.name.toLowerCase()
      const nameWords = nameLower.split(/\s+/).filter(word => word.length > 2) // 2글자 이상 단어만
      
      return {
        symbol: item.symbol,
        name: item.name,
        nameLower: nameLower,
        nameWords: nameWords,
        exchange: item.exchangeShortName || item.exchange,
        type: item.type || 'stock',
        lastUpdated: new Date().toISOString()
      }
    })
    
    // 파일 저장
    const dataDir = path.join(process.cwd(), '..', 'data')
    const filePath = path.join(dataDir, 'nasdaq-symbols.json')
    
    fs.writeFileSync(filePath, JSON.stringify(localDB, null, 2), 'utf-8')
    
    console.log(`✅ 저장 완료: ${filePath}`)
    console.log(`📊 총 ${localDB.length}개 심볼 저장됨`)
    
    // 통계 출력
    const stats = {
      total: localDB.length,
      exchanges: {} as Record<string, number>,
      types: {} as Record<string, number>
    }
    
    localDB.forEach(item => {
      stats.exchanges[item.exchange] = (stats.exchanges[item.exchange] || 0) + 1
      stats.types[item.type] = (stats.types[item.type] || 0) + 1
    })
    
    console.log('\n📈 통계:')
    console.log('  거래소별:')
    Object.entries(stats.exchanges).forEach(([exchange, count]) => {
      console.log(`    ${exchange}: ${count}개`)
    })
    console.log('  타입별:')
    Object.entries(stats.types).forEach(([type, count]) => {
      console.log(`    ${type}: ${count}개`)
    })
    
    // 샘플 데이터 출력
    console.log('\n📋 샘플 데이터 (처음 5개):')
    localDB.slice(0, 5).forEach(item => {
      console.log(`  ${item.symbol} - ${item.name}`)
    })
    
  } catch (error: any) {
    console.error('❌ 다운로드 실패:', error.message)
    if (error.response) {
      console.error('  응답:', error.response.data)
    }
    process.exit(1)
  }
}

// 실행
downloadNasdaqSymbols()

