import os
import time
import json
import hashlib
import requests
from datetime import datetime
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup
from dotenv import load_dotenv
import google.generativeai as genai
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import feedparser  # RSS 파싱용

# .env 파일 로드
env_path = Path(__file__).parent / '.env'
print(f"📂 .env 파일 경로: {env_path}")
print(f"📂 .env 파일 존재: {env_path.exists()}")
load_dotenv(dotenv_path=env_path)

# API 키 및 설정
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
GROK_API_KEY = os.environ.get('GROK_API_KEY', '')
AI_PROVIDER = os.environ.get('AI_PROVIDER', 'gemini').lower()  # 'gemini' 또는 'grok'
BACKEND_URL = 'http://localhost:3001'

# 데이터 저장 디렉토리
DATA_DIR = Path(__file__).parent.parent / 'data'
DATA_DIR.mkdir(exist_ok=True)
NEWS_FILE = DATA_DIR / 'news.json'
RAW_NEWS_FILE = DATA_DIR / 'raw-news.json'  # 영어 원본 (중복 체크용)

print(f"🤖 AI Provider: {AI_PROVIDER.upper()}")
print(f"🔗 Backend URL: {BACKEND_URL}")
print(f"💾 Data directory: {DATA_DIR}")
print(f"📄 Raw news file: {RAW_NEWS_FILE}")
print(f"🔑 GEMINI_API_KEY: {'✓ ' + GEMINI_API_KEY[:20] + '...' if GEMINI_API_KEY else '✗ 없음'}")
print(f"🔑 GROK_API_KEY: {'✓ ' + GROK_API_KEY[:20] + '...' if GROK_API_KEY else '✗ 없음'}")

if AI_PROVIDER == 'gemini':
    if GEMINI_API_KEY:
        genai.configure(api_key=GEMINI_API_KEY)
        print(f"✓ Gemini configured successfully")
    else:
        print(f"⚠️  Warning: GEMINI_API_KEY not set")
elif AI_PROVIDER == 'grok':
    if GROK_API_KEY:
        print(f"✓ Grok configured successfully")
    else:
        print(f"⚠️  Warning: GROK_API_KEY not set")

class GlobeNewswireScraper:
    def __init__(self):
        self.seen_news = set()
        self.driver = None
        self.raw_news_file = RAW_NEWS_FILE
        self.load_raw_ids()  # raw-news.json에서 이미 스크랩된 ID 로드
        
    def load_raw_ids(self):
        """raw-news.json에서 이미 스크랩된 ID만 로드"""
        try:
            if self.raw_news_file.exists():
                with open(self.raw_news_file, 'r', encoding='utf-8') as f:
                    raw_news = json.load(f)
                    self.seen_news = set(item['id'] for item in raw_news)
                    print(f"📂 Raw news 로드: {len(self.seen_news)}개 ID")
            else:
                print(f"📂 Raw news 파일 없음 (신규 시작)")
        except Exception as e:
            print(f"⚠️  Raw news 로드 오류: {e}")
            self.seen_news = set()
    
    def save_raw_news(self, news_data):
        """영어 원본을 raw-news.json에 저장 (API 호출 전)"""
        try:
            # 1. 기존 raw news 로드
            raw_news = []
            if self.raw_news_file.exists():
                with open(self.raw_news_file, 'r', encoding='utf-8') as f:
                    raw_news = json.load(f)
            
            # 2. 새 뉴스 추가
            raw_news.insert(0, news_data)
            
            # 3. 최대 5000개 유지 (용량 관리)
            raw_news = raw_news[:5000]
            
            # 4. 저장
            with open(self.raw_news_file, 'w', encoding='utf-8') as f:
                json.dump(raw_news, f, indent=2, ensure_ascii=False)
            
            # 5. seen_news 업데이트
            self.seen_news.add(news_data['id'])
            
        except Exception as e:
            print(f"✗ Raw news 저장 실패: {e}")
    
    def setup_driver(self):
        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        
        self.driver = webdriver.Chrome(options=chrome_options)
        
    def parse_news_item(self, element):
        """뉴스 항목 파싱"""
        try:
            # 제목과 링크 추출 - .mainLink a를 우선 찾기
            link_elem = None
            link = None
            title = None
            
            # 1순위: .mainLink a (본문 링크)
            try:
                link_elem = element.find_element(By.CSS_SELECTOR, '.mainLink a')
                link = link_elem.get_attribute('href')
                title = link_elem.text.strip()
            except:
                # 2순위: 일반 a 태그
                try:
                    link_elem = element.find_element(By.CSS_SELECTOR, 'a')
                    link = link_elem.get_attribute('href')
                    title = link_elem.text.strip()
                except:
                    return None
            
            if not link or not title:
                return None
            
            # 상대 경로를 절대 경로로 변환
            if link.startswith('/'):
                link = f"https://www.globenewswire.com{link}"
            elif not link.startswith('http'):
                link = f"https://www.globenewswire.com/{link}"
            
            # 전체 텍스트 추출
            full_text = element.text.strip()
            lines = [line.strip() for line in full_text.split('\n') if line.strip()]
            
            # 첫 줄은 보통 시간/소스 정보
            time_line = lines[0] if lines else ''
            
            # 시간 파싱 (ET 기준)
            published_time = ''
            source = ''
            
            # "October 17, 2025 05:05 ET | Source: Company Name" 형식 파싱
            if 'ET' in time_line:
                # "October 17, 2025 05:05 ET" 부분만 추출
                if '|' in time_line:
                    parts = time_line.split('|')
                    published_time = parts[0].strip()
                    
                    # Source 추출
                    if 'Source:' in time_line:
                        source_part = [p for p in parts if 'Source:' in p]
                        if source_part:
                            source = source_part[0].replace('Source:', '').strip()
                else:
                    published_time = time_line.strip()
            elif time_line:
                # ET가 없어도 날짜 형식이면 사용
                published_time = time_line.strip()
            
            # 이미지 추출
            image_url = None
            try:
                img_elem = element.find_element(By.CSS_SELECTOR, 'img')
                image_url = img_elem.get_attribute('src')
            except:
                pass
            
            # 고유 ID 생성
            news_id = hashlib.md5(f"{link}_{title}".encode()).hexdigest()
            
            return {
                'id': news_id,
                'region': 'Y',
                'publishedTime': published_time,
                'localTime': published_time,
                'usTime': published_time,
                'koTime': self.convert_to_korea_time(published_time),
                'source': source,
                'title': title,
                'link': link,
                'imageUrl': image_url
            }
        except Exception as e:
            print(f"Error parsing news item: {e}")
            return None
    
    def convert_to_korea_time(self, et_time):
        """ET 시간을 한국 시간으로 변환"""
        try:
            from datetime import datetime, timedelta
            
            # 간단한 변환 (ET는 UTC-5, 한국은 UTC+9 = 14시간 차이)
            if 'ET' in et_time:
                return et_time.replace('ET', 'KST (+14h)')
            return et_time
        except:
            return et_time
    
    def fetch_news_content(self, url):
        """뉴스 본문 가져오기"""
        try:
            response = requests.get(url, timeout=10)
            soup = BeautifulSoup(response.content, 'lxml')
            
            # 본문 텍스트 추출 (GlobeNewswire 구조에 맞게 조정)
            content = soup.find('div', class_='article-body') or soup.find('div', class_='main-article')
            if content:
                return content.get_text(strip=True, separator=' ')[:2000]
            return ""
        except Exception as e:
            print(f"Error fetching content: {e}")
            return ""
    
    def validate_ticker_with_backend(self, ticker, text):
        """백엔드 API로 티커 검증"""
        try:
            response = requests.post(
                f"{BACKEND_URL}/api/validate-ticker",
                json={'ticker': ticker, 'text': text},
                timeout=5
            )
            if response.status_code == 200:
                return response.json()
            return None
        except Exception as e:
            print(f"⚠️  Ticker validation failed: {e}")
            return None

    def analyze_with_ai(self, title, content, link):
        """AI API로 뉴스 분석 - 회사명 우선 추출 후 백엔드에서 티커 검증"""
        if AI_PROVIDER == 'grok':
            return self.analyze_with_grok(title, content, link)
        else:
            return self.analyze_with_gemini(title, content, link)
    
    def analyze_with_grok(self, title, content, link):
        """Grok API로 뉴스 분석"""
        if not GROK_API_KEY:
            print("Warning: GROK_API_KEY not set, skipping analysis")
            return None
        
        # Timeout 발생 시 재시도 (최대 2번)
        max_retries = 2
        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    print(f"🔄 Retry {attempt}/{max_retries-1}...")
                    time.sleep(2)  # 2초 대기 후 재시도
                
                prompt = f"""Analyze this financial news and extract information IN KOREAN.

Title: {title}
Content: {content[:2000]}

**MOST IMPORTANT - Company Name First:**
1. Extract the EXACT company name from the news (e.g., "Apple Inc.", "Microsoft Corporation", "Tesla, Inc.")
   - Look for the company that is the MAIN SUBJECT of the news
   - NOT companies mentioned in passing
   - NOT author names, NOT analyst names
   - If this is advertising/promotional content (expert explains, tips, advice), return null

2. Ticker symbol (optional):
   - Only if you are 100% certain
   - MUST match the company name you extracted
   - If uncertain, leave as null

3. Sentiment: positive/negative/neutral

4. Calculate percentage split (must total 100%)
   - 호재 요소와 악재 요소를 **균형있게** 평가
   - 과도하게 긍정적이거나 부정적이지 않게

5. Rise score (0-100): **BE CONSERVATIVE AND REALISTIC**
   **평가 기준:**
   - 90-100점: 매우 확실한 호재 (실적 대폭 증가, 대형 계약 체결, 혁신적 신제품 출시)
   - 80-89점: 강력한 호재 (중요한 파트너십, 신규 사업 진출)
   - 70-79점: 긍정적 (임원 임명, 제품 출시, 투자 유치)
   - 60-69점: 약간 긍정적 (일반 발표, 이벤트 참여)
   - 50-59점: 중립 (재무 결과 발표, 일반 공시, 배당 발표)
   - 40점 이하: 부정적 소식
   
   **주의사항:**
   - 단순 공시/발표: 50-60점
   - 임원 임명/인사: 70점 전후
   - 배당/분배 발표: 50-55점
   - 재무 실적 발표(내용 모름): 50점
   - **과장하지 말고 현실적으로 평가**

6. **Translate title and description to Korean**

**CRITICAL - EXCLUDE these types of news:**
- Expert advice, tips, how-to guides
- HelloNation, Edvertising platforms
- General market reports (not specific company)
- Example: "Roofing expert explains..." → companyName: null

**For advertising/non-company news:**
{{
    "companyName": null,
    "ticker": null,
    "sentiment": "neutral",
    "positivePercentage": 50,
    "negativePercentage": 50,
    "riseScore": 50,
    "summary": "일반 뉴스",
    "titleKo": "번역된 제목",
    "descriptionKo": "번역된 설명"
}}

**For real company news:**
{{
    "companyName": "Apple Inc.",
    "ticker": null,
    "sentiment": "positive",
    "positivePercentage": 85,
    "negativePercentage": 15,
    "riseScore": 75,
    "summary": "애플이 신제품 출시 발표",
    "titleKo": "애플, 새로운 아이폰 15 발표",
    "descriptionKo": "애플이 최신 아이폰 15를 공개하며 매출 증가 예상"
}}

Remember: Company name is REQUIRED for stock news. Ticker is optional. MUST include titleKo and descriptionKo. Return ONLY valid JSON."""
                
                response = requests.post(
                    'https://api.x.ai/v1/chat/completions',
                    headers={
                        'Content-Type': 'application/json',
                        'Authorization': f'Bearer {GROK_API_KEY}'
                    },
                    json={
                        'messages': [
                            {'role': 'system', 'content': 'You are a financial news analyst. Always respond with valid JSON only, no markdown or extra text.'},
                            {'role': 'user', 'content': prompt}
                        ],
                        'model': 'grok-4-latest',
                        'stream': False,
                        'temperature': 0.3
                    },
                    timeout=30
                )
                
                if response.status_code != 200:
                    print(f"✗ Grok API error: {response.status_code} {response.text}")
                    if attempt < max_retries - 1:
                        continue
                    return None
                
                result_text = response.json()['choices'][0]['message']['content'].strip()
                
                # JSON 추출
                if '```json' in result_text:
                    result_text = result_text.split('```json')[1].split('```')[0].strip()
                elif '```' in result_text:
                    result_text = result_text.split('```')[1].split('```')[0].strip()
                
                # { } 사이 추출
                if '{' in result_text and '}' in result_text:
                    start = result_text.index('{')
                    end = result_text.rindex('}') + 1
                    result_text = result_text[start:end]
                
                analysis = json.loads(result_text)
                
                # 회사명이 없으면 즉시 거부
                company_name = analysis.get('companyName')
                if not company_name or company_name.strip() == '':
                    print(f"✗ No company name extracted (advertising/non-company news)")
                    analysis['isNasdaqListed'] = False
                    analysis['ticker'] = None
                    return analysis
                
                print(f"✓ Extracted company: {company_name}")
                
                # 백엔드 API로 회사명 기반 티커 검색
                try:
                    response = requests.post(
                        f"{BACKEND_URL}/api/validate-ticker",
                        json={'ticker': '', 'text': company_name},
                        timeout=5
                    )
                    if response.status_code == 200:
                        validation = response.json()
                        
                        if validation.get('isValid') and validation.get('stockInfo'):
                            stock_info = validation['stockInfo']
                            validated_ticker = stock_info.get('symbol')
                            validated_name = stock_info.get('name')
                            
                            print(f"✓ Backend matched: {validated_ticker} = {validated_name}")
                            
                            analysis['ticker'] = validated_ticker
                            analysis['isNasdaqListed'] = True
                            
                            # AI가 추출한 티커와 다르면 경고
                            ai_ticker = analysis.get('ticker')
                            if ai_ticker and ai_ticker != validated_ticker:
                                print(f"⚠️  Ticker corrected: {ai_ticker} → {validated_ticker}")
                        else:
                            print(f"✗ Not found in NASDAQ: {company_name}")
                            analysis['isNasdaqListed'] = False
                            analysis['ticker'] = None
                    else:
                        print(f"✗ Backend validation failed")
                        analysis['isNasdaqListed'] = False
                        analysis['ticker'] = None
                except Exception as e:
                    print(f"✗ Backend API error: {e}")
                    analysis['isNasdaqListed'] = False
                    analysis['ticker'] = None
                
                print(f"✓ Final result: Listed={analysis.get('isNasdaqListed')}, Ticker={analysis.get('ticker')}, Company={company_name}")
                return analysis
                
            except (requests.exceptions.ReadTimeout, requests.exceptions.Timeout) as e:
                print(f"✗ Grok timeout: {e}")
                if attempt < max_retries - 1:
                    continue
                return None
            except Exception as e:
                print(f"✗ Grok analysis error: {e}")
                import traceback
                traceback.print_exc()
                if attempt < max_retries - 1:
                    continue
                return None
        
        # 모든 재시도 실패
        return None
    
    def analyze_batch_with_gemini(self, news_list):
        """Gemini API로 여러 뉴스를 배치 분석 (병렬 처리)"""
        if not GEMINI_API_KEY:
            print("Warning: GEMINI_API_KEY not set, skipping batch analysis")
            return []
        
        print(f"\n🚀 Batch analysis: {len(news_list)} 뉴스 동시 분석 중...")
        results = []
        
        # ThreadPoolExecutor로 병렬 처리 (최대 5개 동시)
        with ThreadPoolExecutor(max_workers=5) as executor:
            future_to_news = {
                executor.submit(self.analyze_with_gemini, news['title'], news['content'], news['link']): news 
                for news in news_list
            }
            
            for future in as_completed(future_to_news):
                news = future_to_news[future]
                try:
                    result = future.result()
                    if result:
                        results.append({'news': news, 'analysis': result})
                except Exception as e:
                    print(f"✗ Batch analysis error for {news['title'][:30]}...: {e}")
        
        print(f"✓ Batch analysis complete: {len(results)}/{len(news_list)} 성공")
        return results
    
    def analyze_with_gemini(self, title, content, link):
        """Gemini API로 뉴스 분석 - 회사명 우선 추출 후 백엔드에서 티커 검증"""
        if not GEMINI_API_KEY:
            return None
            
        try:
            model = genai.GenerativeModel('gemini-2.5-flash')
            
            prompt = f"""Analyze this financial news and extract information IN KOREAN.

Title: {title}
Content: {content[:2000]}

**MOST IMPORTANT - Company Name First:**
1. Extract the EXACT company name from the news (e.g., "Apple Inc.", "Microsoft Corporation", "Tesla, Inc.")
   - Look for the company that is the MAIN SUBJECT of the news
   - NOT companies mentioned in passing
   - NOT author names, NOT analyst names
   - If this is advertising/promotional content (expert explains, tips, advice), return null

2. Ticker symbol (optional):
   - Only if you are 100% certain
   - MUST match the company name you extracted
   - If uncertain, leave as null

3. Sentiment: positive/negative/neutral

4. Calculate percentage split (must total 100%)
   - 호재 요소와 악재 요소를 **균형있게** 평가
   - 과도하게 긍정적이거나 부정적이지 않게

5. Rise score (0-100): **BE CONSERVATIVE AND REALISTIC**
   **평가 기준:**
   - 90-100점: 매우 확실한 호재 (실적 대폭 증가, 대형 계약 체결, 혁신적 신제품 출시)
   - 80-89점: 강력한 호재 (중요한 파트너십, 신규 사업 진출)
   - 70-79점: 긍정적 (임원 임명, 제품 출시, 투자 유치)
   - 60-69점: 약간 긍정적 (일반 발표, 이벤트 참여)
   - 50-59점: 중립 (재무 결과 발표, 일반 공시, 배당 발표)
   - 40점 이하: 부정적 소식
   
   **주의사항:**
   - 단순 공시/발표: 50-60점
   - 임원 임명/인사: 70점 전후
   - 배당/분배 발표: 50-55점
   - 재무 실적 발표(내용 모름): 50점
   - **과장하지 말고 현실적으로 평가**

6. **Translate title and description to Korean**

**CRITICAL - EXCLUDE these types of news:**
- Expert advice, tips, how-to guides
- HelloNation, Edvertising platforms
- General market reports (not specific company)
- Example: "Roofing expert explains..." → companyName: null

**For advertising/non-company news:**
{{
    "companyName": null,
    "ticker": null,
    "sentiment": "neutral",
    "positivePercentage": 50,
    "negativePercentage": 50,
    "riseScore": 50,
    "summary": "일반 뉴스",
    "titleKo": "번역된 제목",
    "descriptionKo": "번역된 설명"
}}

**For real company news:**
{{
    "companyName": "Apple Inc.",
    "ticker": null,
    "sentiment": "positive",
    "positivePercentage": 85,
    "negativePercentage": 15,
    "riseScore": 75,
    "summary": "애플이 신제품 출시 발표",
    "titleKo": "애플, 새로운 아이폰 15 발표",
    "descriptionKo": "애플이 최신 아이폰 15를 공개하며 매출 증가 예상"
}}

Remember: Company name is REQUIRED for stock news. Ticker is optional. MUST include titleKo and descriptionKo. Return ONLY valid JSON."""
            
            response = model.generate_content(prompt)
            result_text = response.text.strip()
            
            # JSON 추출
            if '```json' in result_text:
                result_text = result_text.split('```json')[1].split('```')[0].strip()
            elif '```' in result_text:
                result_text = result_text.split('```')[1].split('```')[0].strip()
            
            # { } 사이 추출
            if '{' in result_text and '}' in result_text:
                start = result_text.index('{')
                end = result_text.rindex('}') + 1
                result_text = result_text[start:end]
            
            analysis = json.loads(result_text)
            
            # 회사명이 없으면 즉시 거부
            company_name = analysis.get('companyName')
            if not company_name or company_name.strip() == '':
                print(f"✗ No company name extracted (advertising/non-company news)")
                analysis['isNasdaqListed'] = False
                analysis['ticker'] = None
                return analysis
            
            print(f"✓ Extracted company: {company_name}")
            
            # 백엔드 API로 회사명 기반 티커 검색
            try:
                response = requests.post(
                    f"{BACKEND_URL}/api/validate-ticker",
                    json={'ticker': '', 'text': company_name},
                    timeout=5
                )
                if response.status_code == 200:
                    validation = response.json()
                    
                    if validation.get('isValid') and validation.get('stockInfo'):
                        stock_info = validation['stockInfo']
                        validated_ticker = stock_info.get('symbol')
                        validated_name = stock_info.get('name')
                        
                        print(f"✓ Backend matched: {validated_ticker} = {validated_name}")
                        
                        analysis['ticker'] = validated_ticker
                        analysis['isNasdaqListed'] = True
                        
                        # Gemini가 추출한 티커와 다르면 경고
                        gemini_ticker = analysis.get('ticker')
                        if gemini_ticker and gemini_ticker != validated_ticker:
                            print(f"⚠️  Ticker corrected: {gemini_ticker} → {validated_ticker}")
                    else:
                        print(f"✗ Not found in NASDAQ: {company_name}")
                        analysis['isNasdaqListed'] = False
                        analysis['ticker'] = None
                else:
                    print(f"✗ Backend validation failed")
                    analysis['isNasdaqListed'] = False
                    analysis['ticker'] = None
            except Exception as e:
                print(f"✗ Backend API error: {e}")
                analysis['isNasdaqListed'] = False
                analysis['ticker'] = None
            
            print(f"✓ Final result: Listed={analysis.get('isNasdaqListed')}, Ticker={analysis.get('ticker')}, Company={company_name}")
            return analysis
            
        except Exception as e:
            print(f"✗ Gemini analysis error: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def translate_with_ai(self, text, max_retries=2):
        """AI API로 번역 - Grok은 비용 절감을 위해 Gemini 사용"""
        # Grok은 비용이 비싸므로 번역은 항상 Gemini 사용
        return self.translate_with_gemini(text, max_retries)
    
    def translate_with_grok(self, text, max_retries=2):
        """Grok API로 번역"""
        if not GROK_API_KEY:
            print("Warning: GROK_API_KEY not set, skipping translation")
            return text
        
        if not text or len(text.strip()) == 0:
            return text
        
        for attempt in range(max_retries):
            try:
                response = requests.post(
                    'https://api.x.ai/v1/chat/completions',
                    headers={
                        'Content-Type': 'application/json',
                        'Authorization': f'Bearer {GROK_API_KEY}'
                    },
                    json={
                        'messages': [
                            {'role': 'system', 'content': 'You are a professional translator. Translate English to Korean naturally.'},
                            {'role': 'user', 'content': f'Translate to Korean (output only Korean, no English):\n\n{text}'}
                        ],
                        'model': 'grok-2-latest',
                        'stream': False,
                        'temperature': 0.3
                    },
                    timeout=30
                )
                
                if response.status_code == 200:
                    translated = response.json()['choices'][0]['message']['content'].strip()
                    
                    # 번역이 제대로 되었는지 확인 (한글 포함 여부)
                    if any('\uac00' <= c <= '\ud7a3' for c in translated):
                        print(f"✓ Translated: {text[:40]}... -> {translated[:40]}...")
                        return translated
                    else:
                        print(f"✗ Translation failed (no Korean detected), retry {attempt+1}/{max_retries}")
                        if attempt == max_retries - 1:
                            return text
                        time.sleep(1)
                else:
                    print(f"✗ Grok translation error: {response.status_code}")
                    if attempt == max_retries - 1:
                        return text
                    time.sleep(1)
                    
            except Exception as e:
                print(f"✗ Translation error (attempt {attempt+1}/{max_retries}): {e}")
                if attempt == max_retries - 1:
                    return text
                time.sleep(1)
        
        return text
    
    def translate_with_gemini(self, text, max_retries=2):
        """Gemini API로 번역"""
        if not GEMINI_API_KEY:
            print("Warning: GEMINI_API_KEY not set, skipping translation")
            return text
        
        if not text or len(text.strip()) == 0:
            return text
            
        for attempt in range(max_retries):
            try:
                model = genai.GenerativeModel('gemini-2.5-flash')
                prompt = f"""Translate the following English text to natural Korean. 
Only output the Korean translation, nothing else:

{text}"""
                
                response = model.generate_content(prompt)
                translated = response.text.strip()
                
                # 번역이 제대로 되었는지 확인 (한글 포함 여부)
                if any('\uac00' <= c <= '\ud7a3' for c in translated):
                    print(f"✓ Translated: {text[:40]}... -> {translated[:40]}...")
                    return translated
                else:
                    print(f"✗ Translation failed (no Korean detected), retry {attempt+1}/{max_retries}")
                    if attempt == max_retries - 1:
                        return text
                    time.sleep(1)
                    
            except Exception as e:
                print(f"✗ Translation error (attempt {attempt+1}/{max_retries}): {e}")
                if attempt == max_retries - 1:
                    import traceback
                    traceback.print_exc()
                    return text
                time.sleep(1)
        
        return text
    
    def fetch_rss_feed(self):
        """GlobeNewswire RSS 피드에서 최신 뉴스 가져오기 (중복 체크 + Raw 저장)"""
        try:
            rss_url = "https://www.globenewswire.com/RssFeed/subjectcode/11-technology/feedTitle/GlobeNewswire%20-%20Technology"
            feed = feedparser.parse(rss_url)
            
            new_news_list = []
            skipped_count = 0
            
            for entry in feed.entries[:30]:  # 최신 30개 확인
                try:
                    # 뉴스 ID 생성
                    news_id = hashlib.md5(entry.link.encode()).hexdigest()
                    
                    # 중복 체크 (API 호출 전!)
                    if news_id in self.seen_news:
                        skipped_count += 1
                        continue
                    
                    # 뉴스 데이터 생성 (영어 원본)
                    news_data = {
                        'id': news_id,
                        'region': 'Y',
                        'publishedTime': entry.get('published', ''),
                        'source': entry.get('author', 'Unknown'),
                        'title': entry.get('title', ''),
                        'link': entry.get('link', ''),
                        'imageUrl': '',
                        'description': entry.get('summary', '')[:300],
                        'content': '',  # 나중에 fetch
                    }
                    
                    # 즉시 Raw 저장 (API 호출 전!)
                    self.save_raw_news(news_data)
                    new_news_list.append(news_data)
                    
                except Exception as e:
                    print(f"✗ RSS entry parse error: {e}")
                    continue
            
            if skipped_count > 0:
                print(f"⏭️  [RSS] {skipped_count}개 중복 건너뜀 (이미 처리됨)")
            
            return new_news_list
        except Exception as e:
            print(f"✗ RSS feed fetch error: {e}")
            return []
    
    def save_to_file(self, news_data):
        """백엔드로 전송 (파일 저장은 백엔드에서 처리)"""
        try:
            # 백엔드로 전송
            response = requests.post(f"{BACKEND_URL}/api/news", json=news_data, timeout=10)
            if response.status_code == 200:
                print(f"📡 백엔드 전송 성공: {news_data['title'][:50]}...")
            else:
                print(f"⚠️  백엔드 응답 오류: {response.status_code}")
        except Exception as e:
            print(f"✗ 백엔드 전송 실패: {e}")
    
    def monitor(self):
        """실시간 모니터링"""
        print("Starting GlobeNewswire scraper...")
        self.setup_driver()
        
        try:
            # 40개씩 가져오는 뉴스룸 페이지로 변경
            news_url = 'https://www.globenewswire.com/NewsRoom?page=1&pageSize=40'
            self.driver.get(news_url)
            time.sleep(5)
            
            print("Monitoring started. Fetching 40 articles per cycle...")
            print(f"Target URL: {news_url}")
            
            # 초기 40개 로드
            print("\n" + "="*60)
            print("초기 로딩: 40개 뉴스 수집 중...")
            print("="*60)
            
            while True:
                try:
                    # 1단계: RSS 피드에서 최신 뉴스 먼저 확인 (빠름 + Raw 저장 완료)
                    print("\n🔍 RSS 피드 확인 중...")
                    rss_news = self.fetch_rss_feed()  # 이미 중복 체크 + Raw 저장 완료
                    
                    if rss_news:
                        print(f"💾 RSS에서 {len(rss_news)}개 신규 뉴스 → Raw 저장 완료")
                        
                        # Content 가져오기
                        for news_data in rss_news:
                            content = self.fetch_news_content(news_data['link'])
                            news_data['content'] = content
                            news_data['description'] = content[:300] if content else news_data['title']
                        
                        print(f"\n{'='*60}")
                        print(f"🚀 RSS: {len(rss_news)}개 AI 분석 시작")
                        print(f"{'='*60}")
                        
                        analyzed_results = self.analyze_batch_with_gemini(rss_news)
                        
                        for result in analyzed_results:
                            news_data = result['news']
                            analysis = result['analysis']
                            
                            if not analysis.get('isNasdaqListed'):
                                continue
                            
                            news_data['analysis'] = analysis
                            news_data['titleKo'] = analysis.get('titleKo', news_data['title'])
                            news_data['descriptionKo'] = analysis.get('descriptionKo', news_data['description'])
                            
                            try:
                                import pytz
                                time_str = news_data['publishedTime'].replace(' ET', '')
                                dt = datetime.strptime(time_str, "%B %d, %Y %H:%M")
                                et_tz = pytz.timezone('US/Eastern')
                                dt_et = et_tz.localize(dt)
                                kr_tz = pytz.timezone('Asia/Seoul')
                                dt_kr = dt_et.astimezone(kr_tz)
                                news_data['publishedTimeKo'] = dt_kr.strftime('%Y년 %m월 %d일 %H:%M:%S')
                            except:
                                news_data['publishedTimeKo'] = news_data['publishedTime']
                            
                            self.save_to_file(news_data)
                            print(f"✅ [RSS] {analysis.get('ticker')} - {news_data['titleKo'][:40]}...")
                    else:
                        print(f"⏭️  RSS: 신규 뉴스 없음")
                    
                    # 2단계: Featured Releases 섹션의 모든 뉴스 항목 찾기 (기존 방식)
                    news_items = []
                    
                    # 여러 셀렉터 시도
                    selectors = [
                        'div.featured-releases article',
                        'div.featured-releases > *',
                        'article',
                        'div[class*="article"]',
                        'li'
                    ]
                    
                    for selector in selectors:
                        try:
                            items = self.driver.find_elements(By.CSS_SELECTOR, selector)
                            if len(items) >= 10:  # 최소 10개 이상 찾으면 성공
                                news_items = items
                                print(f"✓ Found {len(items)} items with selector: {selector}")
                                break
                        except:
                            continue
                    
                    if not news_items:
                        print("⚠️  No news items found. Retrying...")
                        time.sleep(2)
                        self.driver.refresh()
                        time.sleep(3)
                        continue
                    
                    # 최대 40개까지 처리 (배치 방식)
                    processed = 0
                    skipped = 0
                    
                    # 1단계: 모든 뉴스 데이터 수집 (중복 체크 + Raw 저장)
                    batch_news = []
                    for item in news_items[:40]:
                        try:
                            # 링크가 있는지 확인
                            try:
                                link_elem = item.find_element(By.CSS_SELECTOR, 'a')
                            except:
                                skipped += 1
                                continue
                            
                            news_data = self.parse_news_item(item)
                            if not news_data:
                                skipped += 1
                                continue
                            
                            # 중복 체크 (Raw 파일 기반!)
                            if news_data['id'] in self.seen_news:
                                skipped += 1
                                continue
                            
                            print(f"\n{'='*60}")
                            print(f"New article found: {news_data['title'][:50]}...")
                            print(f"Link: {news_data['link']}")
                            
                            # 본문 가져오기
                            content = self.fetch_news_content(news_data['link'])
                            news_data['description'] = content[:300] if content else news_data['title']
                            news_data['content'] = content  # 전체 내용 저장
                            
                            # 즉시 Raw 저장 (API 호출 전!)
                            self.save_raw_news(news_data)
                            batch_news.append(news_data)
                            
                        except Exception as e:
                            print(f"✗ Error collecting news: {e}")
                            skipped += 1
                    
                    # 2단계: 배치 분석 (병렬 처리, Raw 저장 완료 상태)
                    if batch_news:
                        print(f"\n{'='*60}")
                        print(f"🚀 HTML: {len(batch_news)}개 AI 분석 시작 (Raw 저장 완료)")
                        print(f"{'='*60}")
                        
                        analyzed_results = self.analyze_batch_with_gemini(batch_news)
                        
                        # 3단계: 분석 결과 처리
                        for result in analyzed_results:
                            news_data = result['news']
                            analysis = result['analysis']
                            
                            # 나스닥 상장 종목이 아니면 건너뛰기 (seen_news는 이미 Raw에 추가됨)
                            if not analysis.get('isNasdaqListed'):
                                print(f"⏭️  Skipped: {news_data['title'][:30]}... (Not NASDAQ)")
                                skipped += 1
                                continue
                            
                            # 나스닥 상장 종목만 처리
                            news_data['analysis'] = analysis
                            ticker_info = f"[{analysis.get('ticker')}]" if analysis.get('ticker') else "[N/A]"
                            print(f"\n✅ NASDAQ: {ticker_info} {news_data['title'][:40]}...")
                            print(f"   Sentiment: {analysis.get('sentiment', 'N/A')} - {analysis.get('positivePercentage', 0)}% 호재")
                            
                            # AI가 이미 번역을 포함하여 반환
                            news_data['titleKo'] = analysis.get('titleKo', news_data['title'])
                            news_data['descriptionKo'] = analysis.get('descriptionKo', news_data['description'])
                            
                            print(f"   Korean: {news_data['titleKo'][:40]}...")
                            
                            # 게제 시간 한국 변환 추가
                            try:
                                import pytz
                                
                                # 원본 시간을 파싱 (ET 시간대)
                                time_str = news_data['publishedTime'].replace(' ET', '')
                                dt = datetime.strptime(time_str, "%B %d, %Y %H:%M")
                                
                                # ET 시간대 설정
                                et_tz = pytz.timezone('US/Eastern')
                                dt_et = et_tz.localize(dt)
                                
                                # 한국 시간대로 변환
                                kr_tz = pytz.timezone('Asia/Seoul')
                                dt_kr = dt_et.astimezone(kr_tz)
                                
                                # 한국 시간 문자열 생성
                                news_data['publishedTimeKo'] = dt_kr.strftime('%Y년 %m월 %d일 %H:%M:%S')
                            except Exception as e:
                                print(f"⚠️  Time conversion error: {e}")
                                news_data['publishedTimeKo'] = news_data['publishedTime']
                            
                            # 파일 및 백엔드로 저장 (나스닥 종목만)
                            self.save_to_file(news_data)
                            self.seen_news.add(news_data['id'])
                            processed += 1
                            print(f"   💾 Saved: #{processed}")
                    
                    # 건너뛴 뉴스 처리
                    for news_data in batch_news:
                        if news_data['id'] not in self.seen_news:
                            self.seen_news.add(news_data['id'])
                    
                    # 처리 결과 출력
                    print(f"\n📊 처리 결과: 총 {processed}개 처리, {skipped}개 스킵")
                    print(f"💾 Raw DB: {len(self.seen_news)}개 뉴스 (중복 방지)")
                    
                    # 1초 대기 후 새로고침 (RSS로 인해 속도 향상)
                    print(f"\n⏱️  1초 후 새로고침...")
                    time.sleep(1)
                    self.driver.refresh()
                    time.sleep(0.5)
                    
                except Exception as e:
                    print(f"✗ Error in monitoring loop: {e}")
                    import traceback
                    traceback.print_exc()
                    time.sleep(5)
                    try:
                        print("🔄 Refreshing page...")
                        self.driver.refresh()
                        time.sleep(3)
                    except:
                        print("✗ Driver error, restarting...")
                        self.driver.quit()
                        self.setup_driver()
                        self.driver.get(news_url)
                        time.sleep(5)
                    
        except KeyboardInterrupt:
            print("\nStopping scraper...")
        finally:
            if self.driver:
                self.driver.quit()

if __name__ == '__main__':
    scraper = GlobeNewswireScraper()
    scraper.monitor()

