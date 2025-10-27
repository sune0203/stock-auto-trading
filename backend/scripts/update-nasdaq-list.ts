// NASDAQ 전체 리스트 업데이트 (ETF 포함)
import axios from 'axios'
import fs from 'fs'
import path from 'path'

const FMP_API_KEY = 'Nz122fIiH3KWDx8UVBdQFL8a5NU9lRhc'

interface FMPStock {
  symbol: string
  name: string
  price: number
  exchange: string
  exchangeShortName: string
  type: string
}

async function updateNasdaqList() {
  console.log('📥 FMP API에서 NASDAQ 리스트 다운로드 중...')
  
  try {
    // 1. 전체 주식 리스트 가져오기
    const stockResponse = await axios.get<FMPStock[]>(
      `https://financialmodelingprep.com/api/v3/stock/list?apikey=${FMP_API_KEY}`
    )
    
    // 2. NASDAQ 종목만 필터링
    const nasdaqStocks = stockResponse.data.filter(stock => 
      stock.exchangeShortName === 'NASDAQ' || 
      stock.exchange === 'NASDAQ' ||
      stock.exchange === 'Nasdaq Global Market' ||
      stock.exchange === 'Nasdaq Capital Market'
    )
    
    console.log(`✓ 전체 주식: ${stockResponse.data.length}개`)
    console.log(`✓ NASDAQ 주식: ${nasdaqStocks.length}개`)
    
    // 3. ETF 리스트 가져오기
    const etfResponse = await axios.get<FMPStock[]>(
      `https://financialmodelingprep.com/api/v3/etf/list?apikey=${FMP_API_KEY}`
    )
    
    // 4. NASDAQ ETF만 필터링
    const nasdaqETFs = etfResponse.data.filter(etf => 
      etf.exchangeShortName === 'NASDAQ' || 
      etf.exchange === 'NASDAQ'
    )
    
    console.log(`✓ NASDAQ ETF: ${nasdaqETFs.length}개`)
    
    // 5. 합치기
    const allNasdaq = [...nasdaqStocks, ...nasdaqETFs]
    
    // 6. 로컬 DB 포맷으로 변환
    const localDB = allNasdaq.map(item => ({
      symbol: item.symbol.toUpperCase(),
      name: item.name,
      nameLower: item.name.toLowerCase(),
      nameWords: item.name.toLowerCase().split(/\s+/),
      exchange: 'NASDAQ',
      type: item.type || 'stock',
      lastUpdated: new Date().toISOString()
    }))
    
    // 7. 중복 제거 (symbol 기준)
    const uniqueDB = Array.from(
      new Map(localDB.map(item => [item.symbol, item])).values()
    )
    
    console.log(`✓ 최종 개수 (중복 제거): ${uniqueDB.length}개`)
    
    // 8. 파일 저장
    const dataDir = path.join(process.cwd(), '..', 'data')
    const filePath = path.join(dataDir, 'nasdaq-symbols.json')
    
    // 백업 생성
    if (fs.existsSync(filePath)) {
      const backupPath = path.join(dataDir, `nasdaq-symbols.backup.${Date.now()}.json`)
      fs.copyFileSync(filePath, backupPath)
      console.log(`📁 백업 생성: ${backupPath}`)
    }
    
    // 저장
    fs.writeFileSync(filePath, JSON.stringify(uniqueDB, null, 2), 'utf-8')
    console.log(`✅ 저장 완료: ${filePath}`)
    
    // 9. YQQQ 확인
    const yqqq = uniqueDB.find(item => item.symbol === 'YQQQ')
    if (yqqq) {
      console.log(`\n✅ YQQQ 찾음!`)
      console.log(`   이름: ${yqqq.name}`)
      console.log(`   타입: ${yqqq.type}`)
    } else {
      console.log(`\n⚠️  YQQQ를 찾지 못했습니다.`)
    }
    
    // 10. 통계
    const stats = {
      total: uniqueDB.length,
      stocks: uniqueDB.filter(i => i.type === 'stock').length,
      etfs: uniqueDB.filter(i => i.type === 'etf').length,
      others: uniqueDB.filter(i => i.type !== 'stock' && i.type !== 'etf').length
    }
    
    console.log(`\n📊 통계:`)
    console.log(`   전체: ${stats.total}개`)
    console.log(`   주식: ${stats.stocks}개`)
    console.log(`   ETF: ${stats.etfs}개`)
    console.log(`   기타: ${stats.others}개`)
    
  } catch (error: any) {
    console.error('❌ 오류 발생:', error.message)
    if (error.response) {
      console.error('   응답:', error.response.data)
    }
    process.exit(1)
  }
}

updateNasdaqList()

