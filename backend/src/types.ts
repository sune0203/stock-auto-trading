export interface NewsItem {
  id: string;
  region: string;
  publishedTime: string;
  publishedTimeKo?: string; // 게제 시간 한국 변환
  localTime: string;
  usTime: string;
  koTime: string;
  source: string;
  title: string;
  titleKo: string;
  description: string;
  descriptionKo: string;
  link: string;
  imageUrl?: string;
  savedAt?: string; // DB 저장 시간
  analysis?: {
    isNasdaqListed: boolean;
    ticker?: string; // 최종 검증된 티커 (본문 티커)
    extractedTicker?: string; // Gemini가 추출한 원본 티커 (GPT 티커)
    companyName?: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    positivePercentage: number;
    negativePercentage: number;
    riseScore: number; // 당일 상승확률 (0-100점)
    summary?: string;
    currentPrice?: number;
    priceUpdated?: string;
    buyTime?: string; // 매수 체결 시간
    sellTime?: string; // 매도 체결 시간
  };
}

