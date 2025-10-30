import axios from 'axios';
import { config } from './config';

// Gemini API 분석 결과 인터페이스
export interface GeminiAnalysis {
  summary: string;              // 공시 요약
  upProbability: number;        // 상승 확률 (0-100)
  positiveScore: number;        // 호재 점수 (0-10)
  negativeScore: number;        // 악재 점수 (0-10)
  keyPoints: string[];          // 주요 포인트
  recommendation: string;       // 추천 의견
}

// Gemini API 클라이언트
class GeminiAPIClient {
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model;
  }

  // SEC 공시 분석
  async analyzeSECFiling(symbol: string, formType: string, filingText: string): Promise<GeminiAnalysis | null> {
    try {
      const prompt = `
당신은 미국 주식 시장 전문 애널리스트입니다.
다음 SEC 공시를 분석하고 JSON 형식으로 답변해주세요.

종목: ${symbol}
공시 유형: ${formType}
공시 내용: ${filingText.substring(0, 3000)}

다음 형식으로 분석해주세요 (반드시 JSON만 반환):

{
  "summary": "공시 내용을 2-3문장으로 요약",
  "upProbability": 0-100 사이의 숫자 (주가 상승 확률),
  "positiveScore": 0-10 사이의 숫자 (호재 정도),
  "negativeScore": 0-10 사이의 숫자 (악재 정도),
  "keyPoints": ["주요 포인트 1", "주요 포인트 2", "주요 포인트 3"],
  "recommendation": "투자 추천 의견 (매수/관망/매도 중 하나)"
}

중요: JSON만 반환하고 다른 설명은 넣지 마세요.
`;

      const response = await axios.post(
        `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.3,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!result) {
        console.error('❌ Gemini API 응답 없음:', response.data);
        return null;
      }

      console.log(`📝 Gemini 원본 응답:`, result.substring(0, 200));

      // JSON 파싱 (코드 블록 제거)
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('❌ JSON 형식 응답 없음:', result.substring(0, 500));
        return null;
      }

      const analysis: GeminiAnalysis = JSON.parse(jsonMatch[0]);

      // 유효성 검사
      if (
        typeof analysis.summary !== 'string' ||
        typeof analysis.upProbability !== 'number' ||
        typeof analysis.positiveScore !== 'number' ||
        typeof analysis.negativeScore !== 'number' ||
        !Array.isArray(analysis.keyPoints)
      ) {
        console.error('❌ 잘못된 분석 형식:', analysis);
        return null;
      }

      console.log(`✅ ${symbol} 공시 분석 완료 (상승확률: ${analysis.upProbability}%)`);
      return analysis;

    } catch (error: any) {
      console.error('❌ Gemini API 분석 실패:', error.response?.data || error.message);
      return null;
    }
  }

  // SEC 공시 텍스트 가져오기 (FMP 또는 EDGAR)
  async fetchSECFilingText(symbol: string, formType: string, filingUrl: string): Promise<string | null> {
    try {
      // EDGAR에서 직접 가져오기
      const response = await axios.get(filingUrl, {
        headers: {
          'User-Agent': config.sec.userAgent,
        },
        timeout: 10000,
      });

      // HTML 제거하고 텍스트만 추출 (간단한 방법)
      const text = response.data
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return text.substring(0, 5000); // 최대 5000자

    } catch (error) {
      console.error(`❌ ${symbol} SEC 공시 텍스트 가져오기 실패:`, error);
      return null;
    }
  }

  // 간단한 요약 (공시 URL만 있을 때)
  async analyzeSECFilingByURL(symbol: string, formType: string, filingUrl: string): Promise<GeminiAnalysis | null> {
    try {
      const filingText = await this.fetchSECFilingText(symbol, formType, filingUrl);
      
      if (!filingText) {
        console.warn(`⚠️ ${symbol} 공시 텍스트 없음, 기본 분석 반환`);
        // 기본 분석 반환
        return this.getDefaultAnalysis(formType);
      }

      return await this.analyzeSECFiling(symbol, formType, filingText);

    } catch (error) {
      console.error('❌ SEC 공시 URL 분석 실패:', error);
      return this.getDefaultAnalysis(formType);
    }
  }

  // 기본 분석 (API 실패 시)
  private getDefaultAnalysis(formType: string): GeminiAnalysis {
    // 공시 유형별 기본 분석
    const defaultAnalyses: { [key: string]: GeminiAnalysis } = {
      '8-K': {
        summary: '중요 사건 발생 공시입니다.',
        upProbability: 55,
        positiveScore: 6,
        negativeScore: 3,
        keyPoints: ['중요 사건 발생', '추가 정보 필요'],
        recommendation: '관망',
      },
      'S-1': {
        summary: '신규 증권 등록 공시입니다.',
        upProbability: 60,
        positiveScore: 7,
        negativeScore: 2,
        keyPoints: ['신규 자금 조달', '사업 확장 가능성'],
        recommendation: '관망',
      },
      '424B5': {
        summary: '증권 발행 관련 공시입니다.',
        upProbability: 50,
        positiveScore: 5,
        negativeScore: 5,
        keyPoints: ['증권 발행', '희석 가능성'],
        recommendation: '관망',
      },
    };

    return defaultAnalyses[formType] || {
      summary: `${formType} 공시가 제출되었습니다.`,
      upProbability: 50,
      positiveScore: 5,
      negativeScore: 5,
      keyPoints: ['공시 제출'],
      recommendation: '관망',
    };
  }
}

export const geminiClient = new GeminiAPIClient();

