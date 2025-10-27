// 나스닥 종목 심볼 관리
import axios from 'axios'
import fs from 'fs'
import path from 'path'

interface StockInfo {
  symbol: string
  name: string
  exchange: string
}

export class NasdaqSymbols {
  private symbols: Map<string, StockInfo> = new Map()
  private symbolsFile: string
  private lastUpdate: Date | null = null

  constructor() {
    const dataDir = path.join(process.cwd(), '..', 'data')
    this.symbolsFile = path.join(dataDir, 'nasdaq-symbols.json')
    this.loadFromFile()
  }

  // 파일에서 로드
  private loadFromFile() {
    try {
      if (fs.existsSync(this.symbolsFile)) {
        const data = fs.readFileSync(this.symbolsFile, 'utf-8')
        const symbolsData = JSON.parse(data)
        
        symbolsData.symbols.forEach((info: StockInfo) => {
          this.symbols.set(info.symbol.toUpperCase(), info)
        })
        
        this.lastUpdate = new Date(symbolsData.lastUpdate)
        console.log(`✓ Loaded ${this.symbols.size} NASDAQ symbols from cache`)
      }
    } catch (error) {
      console.error('Error loading symbols from file:', error)
    }
  }

  // 파일에 저장
  private saveToFile() {
    try {
      const symbolsArray = Array.from(this.symbols.values())
      const data = {
        lastUpdate: new Date().toISOString(),
        count: symbolsArray.length,
        symbols: symbolsArray
      }
      
      fs.writeFileSync(this.symbolsFile, JSON.stringify(data, null, 2), 'utf-8')
      console.log(`✓ Saved ${symbolsArray.length} NASDAQ symbols to cache`)
    } catch (error) {
      console.error('Error saving symbols to file:', error)
    }
  }


  // 심볼이 나스닥 종목인지 확인
  isNasdaqSymbol(symbol: string): boolean {
    return this.symbols.has(symbol.toUpperCase())
  }

  // 종목 정보 가져오기
  getStockInfo(symbol: string): StockInfo | undefined {
    return this.symbols.get(symbol.toUpperCase())
  }

  // 텍스트에서 나스닥 심볼 찾기
  findSymbolsInText(text: string): string[] {
    const found: string[] = []
    const upperText = text.toUpperCase()
    
    // 모든 나스닥 심볼을 체크
    for (const [symbol, info] of this.symbols.entries()) {
      // 심볼이 단어로 존재하는지 체크 (예: "AAPL", "AAPL's", "AAPL,")
      const pattern = new RegExp(`\\b${symbol}\\b`, 'i')
      if (pattern.test(text)) {
        found.push(symbol)
        continue
      }
      
      // 회사명이 포함되어 있는지 체크
      if (upperText.includes(info.name.toUpperCase())) {
        found.push(symbol)
      }
    }
    
    return found
  }

  // 모든 심볼 가져오기
  getAllSymbols(): string[] {
    return Array.from(this.symbols.keys())
  }

  // 심볼 개수
  getCount(): number {
    return this.symbols.size
  }
}

