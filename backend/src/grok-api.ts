// Grok API (xAI) 클라이언트
import 'dotenv/config'
import axios from 'axios'

const GROK_API_KEY = process.env.GROK_API_KEY || ''
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions'

if (!GROK_API_KEY) {
  console.warn('⚠️  GROK_API_KEY가 설정되지 않았습니다.')
} else {
  console.log('✓ GROK_API_KEY 로드됨')
}

export interface NewsAnalysis {
  isNasdaqListed: boolean
  ticker?: string
  companyName?: string
  sentiment: 'positive' | 'negative' | 'neutral'
  positivePercentage: number
  negativePercentage: number
  riseScore: number // 당일 상승확률 (0-100점)
  summary?: string
}

export class GrokApi {
  async analyzeNews(title: string, description: string): Promise<NewsAnalysis> {
    if (!GROK_API_KEY) {
      console.warn('⚠️  Grok API 키가 없어서 기본값 반환')
      return {
        isNasdaqListed: false,
        sentiment: 'neutral',
        positivePercentage: 0,
        negativePercentage: 0,
        riseScore: 50
      }
    }

    try {
      const prompt = `
다음 뉴스를 분석해주세요:

제목: ${title}
내용: ${description}

다음 정보를 JSON 형식으로 추출해주세요:

1. **회사명 (companyName)**: 뉴스에서 언급된 주요 회사명을 정확히 추출 (예: Apple Inc., Microsoft Corporation)
2. **티커 (ticker)**: 
   - **중요**: NASDAQ 거래소에 상장된 주식의 티커만 추출
   - NYSE, AMEX, 기타 거래소는 제외
   - 예시: AAPL (O), MSFT (O), PAC (X - NYSE), GAP (X - BMV)
   - NASDAQ이 아니면 빈 문자열 또는 null 반환
3. **요약 (summary)**: 뉴스 내용을 한글로 2-3문장 요약
4. **호재/악재 분석**:
   - positivePercentage: 호재 요소의 비율 (0-100)
   - negativePercentage: 악재 요소의 비율 (0-100)
   - sentiment: 'positive', 'negative', 'neutral' 중 하나
5. **당일 상승확률 (riseScore)**: 
   - 이 뉴스가 발표된 당일, 해당 주식이 상승할 확률을 0-100점으로 평가
   - 고려사항: 뉴스의 긍정성, 시장 반응 예측, 실적/제품 발표의 중요도
   - 예: 신제품 발표(80점), 실적 호조(75점), 소송(20점), 중립 뉴스(50점)

**절대 규칙:**
- NASDAQ이 아닌 거래소 (NYSE, AMEX, BMV, TSX 등)는 ticker를 null로 설정
- 회사명은 반드시 추출 (거래소 무관)
- 티커가 확실하지 않으면 null 반환
- 호재/악재는 주가에 미치는 영향을 기준으로 판단
- riseScore는 단기(당일) 주가 상승 가능성을 객관적으로 평가

**광고성/홍보성 뉴스 제외:**
- "Expert explains", "Specialist shares", "Professional breaks down" 같은 제목은 광고
- HelloNation, Edvertising 같은 광고 플랫폼의 뉴스는 ticker를 null로 설정
- 특정 회사의 실적/제품/인수합병이 아닌 일반 조언/팁 뉴스는 제외
- 예: "지붕 전문가가 설명하는..." (X), "애플이 신제품 발표" (O)

응답 형식 (NASDAQ인 경우):
{
  "companyName": "Apple Inc.",
  "ticker": "AAPL",
  "summary": "애플이 신제품을 발표했습니다...",
  "positivePercentage": 80,
  "negativePercentage": 20,
  "riseScore": 75,
  "sentiment": "positive"
}

응답 형식 (NASDAQ이 아닌 경우):
{
  "companyName": "Grupo Aeroportuario del Pacifico",
  "ticker": null,
  "summary": "멕시코 공항 운영사가 실적을 발표했습니다...",
  "positivePercentage": 70,
  "negativePercentage": 30,
  "riseScore": 65,
  "sentiment": "positive"
}

**중요: JSON만 반환하세요. 다른 텍스트는 포함하지 마세요.**
`

      const response = await axios.post(
        GROK_API_URL,
        {
          messages: [
            {
              role: 'system',
              content: 'You are a financial news analyst. Always respond with valid JSON only, no markdown or extra text.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          model: 'grok-4-latest',
          stream: false,
          temperature: 0.3
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROK_API_KEY}`
          },
          timeout: 30000
        }
      )

      const text = response.data.choices[0].message.content.trim()
      
      // JSON 파싱 시도
      try {
        // JSON 블록 추출
        let jsonText = text
        if (text.includes('```json')) {
          jsonText = text.split('```json')[1].split('```')[0].trim()
        } else if (text.includes('```')) {
          jsonText = text.split('```')[1].split('```')[0].trim()
        }
        
        // { } 사이 추출
        if (jsonText.includes('{') && jsonText.includes('}')) {
          const start = jsonText.indexOf('{')
          const end = jsonText.lastIndexOf('}') + 1
          jsonText = jsonText.substring(start, end)
        }
        
        const analysis = JSON.parse(jsonText)
        
        // 기본값 설정
        return {
          isNasdaqListed: !!analysis.ticker,
          ticker: analysis.ticker,
          companyName: analysis.companyName,
          sentiment: analysis.sentiment || 'neutral',
          positivePercentage: analysis.positivePercentage || 0,
          negativePercentage: analysis.negativePercentage || 0,
          riseScore: analysis.riseScore || 50,
          summary: analysis.summary
        }
      } catch (parseError) {
        console.error('Grok 응답 파싱 오류:', parseError)
        console.error('원본 응답:', text)
        
        // 파싱 실패 시 기본값 반환
        return {
          isNasdaqListed: false,
          sentiment: 'neutral',
          positivePercentage: 0,
          negativePercentage: 0,
          riseScore: 50
        }
      }
    } catch (error: any) {
      console.error('Grok API 오류:', error.response?.data || error.message)
      return {
        isNasdaqListed: false,
        sentiment: 'neutral',
        positivePercentage: 0,
        negativePercentage: 0,
        riseScore: 50
      }
    }
  }
}

export const grokApi = new GrokApi()

