// 로컬 나스닥 심볼 매칭 시스템
import fs from 'fs'
import path from 'path'

interface LocalSymbolDB {
  symbol: string
  name: string
  nameLower: string
  nameWords: string[]
  exchange: string
  type: string
  lastUpdated: string
}

interface MatchResult {
  symbol: string
  name: string
  score: number
  matchType: 'exact' | 'start' | 'word' | 'partial' | 'symbol'
}

export class LocalSymbolMatcher {
  private symbols: LocalSymbolDB[] = []
  private symbolMap: Map<string, LocalSymbolDB> = new Map()
  private nameMap: Map<string, LocalSymbolDB> = new Map()
  
  constructor() {
    this.loadSymbols()
  }
  
  // 심볼 데이터 로드
  private loadSymbols() {
    try {
      const dataDir = path.join(process.cwd(), '..', 'data')
      const filePath = path.join(dataDir, 'nasdaq-symbols.json')
      
      if (!fs.existsSync(filePath)) {
        // 파일이 없어도 조용히 무시 (선택적 기능)
        return
      }
      
      const data = fs.readFileSync(filePath, 'utf-8')
      this.symbols = JSON.parse(data)
      
      // 빠른 검색을 위한 Map 생성
      this.symbols.forEach(symbol => {
        this.symbolMap.set(symbol.symbol.toUpperCase(), symbol)
        this.nameMap.set(symbol.nameLower, symbol)
      })
      
      console.log(`✓ 로컬 심볼 DB 로드: ${this.symbols.length}개`)
    } catch (error) {
      // 에러 무시 (선택적 기능)
    }
  }
  
  // 심볼로 직접 검색
  findBySymbol(symbol: string): LocalSymbolDB | null {
    return this.symbolMap.get(symbol.toUpperCase()) || null
  }
  
  // 회사명으로 검색 (정확도 점수 포함)
  findByCompanyName(companyName: string, limit: number = 5): MatchResult[] {
    if (!companyName || companyName.length < 2) {
      return []
    }
    
    const queryLower = companyName.toLowerCase().trim()
    const queryWords = queryLower.split(/\s+/).filter(word => word.length > 2)
    const results: MatchResult[] = []
    
    for (const symbol of this.symbols) {
      let score = 0
      let matchType: MatchResult['matchType'] = 'partial'
      
      // 1. 완전 일치 (100점)
      if (symbol.nameLower === queryLower) {
        score = 100
        matchType = 'exact'
      }
      // 2. 시작 일치 (90점) - 단, 쿼리가 충분히 길어야 함
      else if (symbol.nameLower.startsWith(queryLower)) {
        // 짧은 문자열 (3글자 이하) 패널티
        if (queryLower.length <= 3) {
          // "ING"가 "Ingles"와 매칭되는 것 방지
          const lengthRatio = queryLower.length / symbol.nameLower.length
          if (lengthRatio < 0.3) {
            // 쿼리가 전체 이름의 30% 미만이면 낮은 점수
            score = 50
          } else {
            score = 90
          }
        } else {
          score = 90
        }
        matchType = 'start'
      }
      // 3. 단어 경계 일치 (80점)
      else if (new RegExp(`\\b${this.escapeRegex(queryLower)}\\b`).test(symbol.nameLower)) {
        score = 80
        matchType = 'word'
      }
      // 4. 포함 (70점) - 단, 쿼리가 충분히 길어야 함
      else if (symbol.nameLower.includes(queryLower)) {
        if (queryLower.length <= 3) {
          score = 40  // 너무 짧으면 낮은 점수
        } else {
          score = 70
        }
        matchType = 'partial'
      }
      // 5. 단어별 매칭 (60-50점)
      else if (queryWords.length > 0) {
        const matchedWords = queryWords.filter(word => 
          symbol.nameWords.some(sw => sw.includes(word) || word.includes(sw))
        )
        if (matchedWords.length > 0) {
          score = 50 + (matchedWords.length / queryWords.length) * 10
          matchType = 'partial'
        }
      }
      
      // 주식(stock)에 가산점
      if (symbol.type === 'stock') {
        score += 5
      }
      
      // 임계값: 70점 이상만 반환 (이전 50점에서 상향)
      if (score >= 70) {
        results.push({
          symbol: symbol.symbol,
          name: symbol.name,
          score: Math.min(100, score),
          matchType
        })
      }
    }
    
    // 점수 높은 순 정렬
    results.sort((a, b) => b.score - a.score)
    
    return results.slice(0, limit)
  }
  
  // Gemini 추출 결과 검증
  validateGeminiResult(companyName?: string, ticker?: string): {
    valid: boolean
    symbol?: string
    name?: string
    confidence: number
    method: string
  } {
    // 무효 티커 필터 (일반명사, 카테고리, 다른 거래소)
    const invalidTickers = [
      'TEAM', 'COST', 'VIA', 'SOURCE', 'NEWS', 'DATA', 'REPORT', 
      'PAC', 'GAP', 'MNY', 'BTSG', // NYSE, BMV 등 다른 거래소
      'INC', 'CORP', 'LTD', 'LLC', 'CO', 'GROUP' // 회사 접미사
    ]
    
    // 1. 회사명 우선 검증 (가장 정확함)
    if (companyName && companyName.length > 3) {
      const matches = this.findByCompanyName(companyName, 1)
      
      if (matches.length > 0 && matches[0].score >= 70) {
        const matchedSymbol = matches[0].symbol
        
        // 티커도 제공되었다면 교차 검증
        if (ticker) {
          if (ticker.toUpperCase() === matchedSymbol.toUpperCase()) {
            // 회사명 + 티커 일치 (최고 신뢰도)
            return {
              valid: true,
              symbol: matchedSymbol,
              name: matches[0].name,
              confidence: 99,
              method: 'name_and_ticker_match'
            }
          } else {
            // 회사명 일치, 티커 불일치 → 회사명 우선
            console.log(`⚠️  티커 불일치: Gemini="${ticker}" vs DB="${matchedSymbol}"`)
            console.log(`   → 회사명 "${companyName}" 기준으로 ${matchedSymbol} 선택`)
            return {
              valid: true,
              symbol: matchedSymbol,
              name: matches[0].name,
              confidence: matches[0].score,
              method: 'name_match_corrected_ticker'
            }
          }
        }
        
        // 회사명만 있고 티커 없음
        return {
          valid: true,
          symbol: matchedSymbol,
          name: matches[0].name,
          confidence: matches[0].score,
          method: `name_only_${matches[0].matchType}`
        }
      }
    }
    
    // 2. 회사명 매칭 실패 → 티커로 재시도 (단, 회사명이 있어야 함)
    if (ticker && companyName) {
      // 무효 티커 체크
      if (invalidTickers.includes(ticker.toUpperCase())) {
        console.log(`⚠️  무효 티커 필터링: ${ticker} (블랙리스트)`)
        return {
          valid: false,
          confidence: 0,
          method: 'invalid_ticker'
        }
      }
      
      const symbolResult = this.findBySymbol(ticker)
      if (symbolResult) {
        // 티커는 DB에 있지만, 회사명과 맞는지 확인
        const nameSimilarity = this.calculateSimilarity(
          companyName.toLowerCase(), 
          symbolResult.nameLower
        )
        
        if (nameSimilarity >= 0.3) { // 30% 이상 유사
          console.log(`✓ 티커 ${ticker} + 회사명 유사도 ${(nameSimilarity * 100).toFixed(0)}%`)
          return {
            valid: true,
            symbol: symbolResult.symbol,
            name: symbolResult.name,
            confidence: Math.round(nameSimilarity * 100),
            method: 'ticker_with_name_check'
          }
        } else {
          console.log(`❌ 티커 ${ticker}는 존재하나 회사명 불일치`)
          console.log(`   Gemini: "${companyName}"`)
          console.log(`   DB: "${symbolResult.name}"`)
          console.log(`   유사도: ${(nameSimilarity * 100).toFixed(0)}%`)
          return {
            valid: false,
            confidence: 0,
            method: 'ticker_name_mismatch'
          }
        }
      }
    }
    
    // 3. 티커만 있고 회사명 없음 → 거부 (광고 뉴스 가능성 높음)
    if (ticker && !companyName) {
      console.log(`❌ 회사명 없이 티커만 제공됨: ${ticker} (광고 뉴스 가능성)`)
      return {
        valid: false,
        confidence: 0,
        method: 'ticker_only_rejected'
      }
    }
    
    // 4. 매칭 실패
    return {
      valid: false,
      confidence: 0,
      method: 'no_match'
    }
  }
  
  // 문자열 유사도 계산 (Jaccard Index)
  private calculateSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.toLowerCase().split(/\s+/).filter(w => w.length > 2))
    const words2 = new Set(str2.toLowerCase().split(/\s+/).filter(w => w.length > 2))
    
    const intersection = new Set([...words1].filter(x => words2.has(x)))
    const union = new Set([...words1, ...words2])
    
    return union.size > 0 ? intersection.size / union.size : 0
  }
  
  // 정규식 이스케이프
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  
  // 통계 조회
  getStats() {
    return {
      total: this.symbols.length,
      byType: this.symbols.reduce((acc, s) => {
        acc[s.type] = (acc[s.type] || 0) + 1
        return acc
      }, {} as Record<string, number>)
    }
  }
}

