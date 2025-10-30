# 나스닥 동전주 급등 패턴 자동 탐지 프로젝트 (Cursor 작업용)

이 문서는 Cursor 환경에서 **나스닥 동전주 급등 탐지 프로그램**을 구축하기 위한 전체 구성 및 코드 지침을 정리한 **개발 가이드 문서**입니다.

DB정보
DB_HOST=116.122.37.82
DB_USER=nasdaq
DB_PASS=core1601!
DB_NAME=nasdaq
DB_PORT=3306

FMP 키값
FMP_API_KEY=Nz122fIiH3KWDx8UVBdQFL8a5NU9lRhc

위 키값 및 DB정보를 사용하면된다.

FMP 참고 API 링크
https://site.financialmodelingprep.com/developer/docs#8k-latest
https://site.financialmodelingprep.com/developer/docs#financials-latest
https://site.financialmodelingprep.com/developer/docs#search-by-symbol
https://site.financialmodelingprep.com/developer/docs#search-by-form-type
https://site.financialmodelingprep.com/developer/docs#search-by-cik
https://site.financialmodelingprep.com/developer/docs#search-by-name
https://site.financialmodelingprep.com/developer/docs#company-search-by-symbol
https://site.financialmodelingprep.com/developer/docs#company-search-by-cik
https://site.financialmodelingprep.com/developer/docs#sec-company-full-profile
https://site.financialmodelingprep.com/developer/docs#industry-classification-list
https://site.financialmodelingprep.com/developer/docs#industry-classification-search
https://site.financialmodelingprep.com/developer/docs#all-industry-classification
https://site.financialmodelingprep.com/developer/docs#historical-price-eod-full
https://financialmodelingprep.com/stable/aftermarket-trade?symbol=AAPL&apikey=Nz122fIiH3KWDx8UVBdQFL8a5NU9lRhc
https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=Nz122fIiH3KWDx8UVBdQFL8a5NU9lRhc
https://site.financialmodelingprep.com/developer/docs#intraday-1-min .............1,5,15,30,1h,4h 사용가능
---

## 📁 프로젝트 구조

```
📦 nasdaq_surge_detector
 ┣ 📂 data
 ┃ ┗── historical_data.csv         # 과거 시세 데이터 (백테스트용)
 ┣ 📂 utils
 ┃ ┣── __init__.py
 ┃ ┗── sec_monitor.py              # SEC 공시 감지 모듈 (EDGAR + FMP)
 ┣── scanner.py                     # 스캐너: 점수 계산 및 필터링
 ┣── realtime_bot.py                # 실시간 모니터링 봇 (텔레그램 등)
 ┣── backtest.py                    # 백테스트 스크립트 (2년간 급등 패턴 검증)
 ┣── .env                           # 환경변수 설정
 ┗── requirements.txt               # 의존 패키지 목록
```

---

## ⚙️ 1. 환경 설정

### requirements.txt
```txt
pandas
requests
feedparser
python-dotenv
schedule
python-telegram-bot
```

### .env 예시
```bash
# FMP API KEY
FMP_TOKEN=YOUR_FMP_API_KEY

# SEC USER AGENT (SEC 권장: 이메일 형태)
SEC_USER_AGENT=youremail@example.com

# SEC 이벤트 감지 설정
EVENT_LOOKBACK_DAYS=2
EDGAR_RSS=https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K
EDGAR_RATE_LIMIT=0.2

# TELEGRAM 알림 (선택)
TELEGRAM_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=YOUR_CHAT_ID
```

---

## 🧠 2. SEC 공시 감지 모듈 (`utils/sec_monitor.py`)

```python
import os, time, requests, feedparser, datetime as dt

def get_cik_via_fmp(ticker: str) -> str | None:
    try:
        key = os.getenv('FMP_TOKEN')
        if not key:
            return None
        url = f"https://financialmodelingprep.com/api/v3/profile/{ticker}?apikey={key}"
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        js = r.json()
        if isinstance(js, list) and js:
            cik = js[0].get('cik') or js[0].get('cikNumber')
            if cik:
                return str(cik).zfill(10).lstrip('0')
    except Exception:
        return None
    return None

def edgar_company_feed_recent(cik: str, form_types: list[str], lookback_days: int) -> bool:
    try:
        base = "https://www.sec.gov/cgi-bin/browse-edgar"
        type_q = "&type=" + "+".join(form_types)
        url = f"{base}?action=getcompany&CIK={cik}{type_q}&count=40&output=atom"
        feed = feedparser.parse(url)
        if not getattr(feed, 'entries', None):
            return False
        now = dt.datetime.utcnow()
        for e in feed.entries[:40]:
            p = getattr(e, 'published_parsed', None) or getattr(e, 'updated_parsed', None)
            if not p:
                continue
            ts = dt.datetime(*p[:6])
            if (now - ts).days <= lookback_days:
                return True
    except Exception:
        return False
    return False

def detect_recent_event(ticker: str) -> bool:
    lookback_days = int(os.getenv('EVENT_LOOKBACK_DAYS', '2'))
    target_forms = {"8-K", "424B5", "S-1", "S-3", "F-3", "424B2", "424B3"}

    # 1️⃣ FMP SEC Filings
    try:
        key = os.getenv('FMP_TOKEN')
        if key:
            url = f"https://financialmodelingprep.com/api/v3/sec_filings/{ticker}?apikey={key}"
            r = requests.get(url, timeout=10)
            r.raise_for_status()
            for d in r.json()[:10]:
                ftype = (d.get('type') or '').upper()
                fdate = d.get('fillingDate') or d.get('filingDate')
                if ftype in target_forms and fdate:
                    filed = dt.datetime.fromisoformat(fdate)
                    if (dt.datetime.utcnow() - filed).days <= lookback_days:
                        return True
    except Exception:
        pass

    # 2️⃣ EDGAR 회사별 Atom
    try:
        cik = get_cik_via_fmp(ticker)
        if cik and edgar_company_feed_recent(cik, list(target_forms), lookback_days):
            return True
    except Exception:
        pass

    # 3️⃣ 백업: 전체 8-K RSS에서 티커 문자열 매칭
    try:
        rss = os.getenv('EDGAR_RSS')
        feed = feedparser.parse(rss)
        for entry in getattr(feed, 'entries', [])[:100]:
            title = (getattr(entry, 'title', '') or '').lower()
            summary = (getattr(entry, 'summary', '') or '').lower()
            if ticker.lower() in title or ticker.lower() in summary:
                p = getattr(entry, 'published_parsed', None)
                if not p:
                    return True
                ts = dt.datetime(*p[:6])
                if (dt.datetime.utcnow() - ts).days <= lookback_days:
                    return True
        time.sleep(float(os.getenv('EDGAR_RATE_LIMIT', '0.2')))
    except Exception:
        pass

    return False
```

---

## 🔍 3. 스캐너 (`scanner.py`)

```python
import os, pandas as pd
from dotenv import load_dotenv
from utils.sec_monitor import detect_recent_event

load_dotenv()

def compute_score(row):
    score = 0
    reasons = []
    
    # 거래량 전조 조건
    if row['VR20'] >= 1.5:
        score += 25; reasons.append('거래량 증가')
    if row['BB_Squeeze']:
        score += 15; reasons.append('BB폭 축소')
    if abs(row['Price_Change']) <= 0.03:
        score += 10; reasons.append('보합 매집')
    if row['GoldenCross']:
        score += 10; reasons.append('5일선↗20일선')
    if row['Float'] < 20_000_000:
        score += 5; reasons.append('유통량 적음')

    # SEC 이벤트 감지
    if detect_recent_event(row['Ticker']):
        score += 20; reasons.append('SEC 이벤트 감지')
    
    return score, ", ".join(reasons)


def run_scan(input_csv='data/historical_data.csv'):
    df = pd.read_csv(input_csv)
    df['Score'], df['Reasons'] = zip(*df.apply(compute_score, axis=1))
    result = df.sort_values(by='Score', ascending=False)
    result.to_csv('scan_result.csv', index=False)
    print(result[['Ticker','Score','Reasons']].head(30))

if __name__ == '__main__':
    run_scan()
```

---

## 🤖 4. 실시간 모니터링 봇 (`realtime_bot.py`)

```python
import schedule, time, os
from scanner import run_scan
from telegram import Bot

bot = Bot(token=os.getenv('TELEGRAM_TOKEN'))
CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

def job():
    run_scan()
    bot.send_message(chat_id=CHAT_ID, text='[자동 스캔 완료] 급등 예고 종목 업데이트됨 ✅')

schedule.every(15).minutes.do(job)

if __name__ == '__main__':
    while True:
        schedule.run_pending()
        time.sleep(60)
```

---

## 📊 5. 백테스트 (`backtest.py`)

```python
import pandas as pd

def backtest(data_csv='data/historical_data.csv'):
    df = pd.read_csv(data_csv)
    df['Future_Max'] = df['Close'].rolling(window=10).max().shift(-10)
    df['Return'] = (df['Future_Max'] - df['Close']) / df['Close']
    candidates = df[df['Score'] >= 70]
    success_rate = (candidates['Return'] >= 1.0).mean() * 100
    print(f"급등후 10일내 2배 상승 성공률: {success_rate:.2f}%")

if __name__ == '__main__':
    backtest()
```

---

## 🧩 6. 실행 명령어

```bash
# 환경설정 로드
source venv/bin/activate

# 스캐너 실행
python scanner.py

# 실시간 모니터링
python realtime_bot.py

# 백테스트 수행
python backtest.py
```

---

## 📘 요약

| 모듈 | 주요 역할 | 출력 |
|------|------------|------|
| `sec_monitor.py` | SEC 공시 감지 (EDGAR + FMP) | True/False 이벤트 신호 |
| `scanner.py` | 급등 전조 점수 계산 | CSV(`scan_result.csv`) |
| `realtime_bot.py` | 실시간 모니터링 + 알림 | Telegram 메시지 |
| `backtest.py` | 과거 데이터로 재현율 검증 | 승률 통계 |

---

> 이 md 파일을 Cursor에 불러와서 폴더 구조를 자동으로 생성하면,  
> 즉시 **실행 가능한 급등탐지 시스템**을 구성할 수 있습니다 🚀

