Company Search
Stock Symbol Search API
Globe Flag
Easily find the ticker symbol of any stock with the FMP Stock Symbol Search API. Search by symbol across multiple global markets.

Endpoint:

https://financialmodelingprep.com/stable/search-symbol?query=AAPL

Parameters

Query Parameter

Type

Example

query*

string

AAPL

limit

number

50

exchange

string

NASDAQ

(*) Required
Response
1
2
3
4
5
6
7
8
9
[
	{
		"symbol": "AAPL",
		"name": "Apple Inc.",
		"currency": "USD",
		"exchangeFullName": "NASDAQ Global Select",
		"exchange": "NASDAQ"
	}
]

Company Name Search API
Globe Flag
Search for ticker symbols, company names, and exchange details for equity securities and ETFs listed on various exchanges with the FMP Name Search API. This endpoint is useful for retrieving ticker symbols when you know the full or partial company or asset name but not the symbol identifier.

Endpoint:

https://financialmodelingprep.com/stable/search-name?query=AA

Parameters

Query Parameter

Type

Example

query*

string

AA

limit

number

50

exchange

string

NASDAQ

(*) Required
Response
1
2
3
4
5
6
7
8
9
[
	{
		"symbol": "AAGUSD",
		"name": "AAG USD",
		"currency": "USD",
		"exchangeFullName": "CCC",
		"exchange": "CRYPTO"
	}
]

CIK API
USA Flag
Easily retrieve the Central Index Key (CIK) for publicly traded companies with the FMP CIK API. Access unique identifiers needed for SEC filings and regulatory documents for a streamlined compliance and financial analysis process.

Endpoint:

https://financialmodelingprep.com/stable/search-cik?cik=320193

Parameters

Query Parameter

Type

Example

cik*

string

320193

limit

number

50

(*) Required
Response
1
2
3
4
5
6
7
8
9
10
[
	{
		"symbol": "AAPL",
		"companyName": "Apple Inc.",
		"cik": "0000320193",
		"exchangeFullName": "NASDAQ Global Select",
		"exchange": "NASDAQ",
		"currency": "USD"
	}
]

CUSIP API
Globe Flag
Easily search and retrieve financial securities information by CUSIP number using the FMP CUSIP API. Find key details such as company name, stock symbol, and market capitalization associated with the CUSIP.

Endpoint:

https://financialmodelingprep.com/stable/search-cusip?cusip=037833100

Parameters

Query Parameter

Type

Example

cusip*

string

037833100

(*) Required
Response
1
2
3
4
5
6
7
8
[
	{
		"symbol": "AAPL",
		"companyName": "Apple Inc.",
		"cusip": "037833100",
		"marketCap": 3542555295744
	}
]

ISIN API
Globe Flag
Easily search and retrieve the International Securities Identification Number (ISIN) for financial securities using the FMP ISIN API. Find key details such as company name, stock symbol, and market capitalization associated with the ISIN.

Endpoint:

https://financialmodelingprep.com/stable/search-isin?isin=US0378331005

Parameters

Query Parameter

Type

Example

isin*

string

US0378331005

(*) Required
Response
1
2
3
4
5
6
7
8
[
	{
		"symbol": "AAPL",
		"name": "Apple Inc.",
		"isin": "US0378331005",
		"marketCap": 3427916386000
	}
]

Stock Screener API
Globe Flag
Discover stocks that align with your investment strategy using the FMP Stock Screener API. Filter stocks based on market cap, price, volume, beta, sector, country, and more to identify the best opportunities.

Endpoint:

https://financialmodelingprep.com/stable/company-screener

Parameters

Query Parameter

Type

Example

marketCapMoreThan

number

1000000

marketCapLowerThan

number

1000000000

sector

string

Technology

industry

string

Consumer Electronics

betaMoreThan

number

0.5

betaLowerThan

number

1.5

priceMoreThan

number

10

priceLowerThan

number

200

dividendMoreThan

number

0.5

dividendLowerThan

number

2

volumeMoreThan

number

1000

volumeLowerThan

number

1000000

exchange

string

NASDAQ

country

string

US

isEtf

boolean

false

isFund

boolean

false

isActivelyTrading

boolean

true

limit

number

1000

includeAllShareClasses

boolean

false

(*) Required
Response
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
[
	{
		"symbol": "AAPL",
		"companyName": "Apple Inc.",
		"marketCap": 3435062313000,
		"sector": "Technology",
		"industry": "Consumer Electronics",
		"beta": 1.24,
		"price": 225.93,
		"lastAnnualDividend": 1,
		"volume": 43010091,
		"exchange": "NASDAQ Global Select",
		"exchangeShortName": "NASDAQ",
		"country": "US",
		"isEtf": false,
		"isFund": false,
		"isActivelyTrading": true
	}
]

Exchange Variants API
Globe Flag
Search across multiple public exchanges to find where a given stock symbol is listed using the FMP Exchange Variants API. This allows users to quickly identify all the exchanges where a security is actively traded.

Endpoint:

https://financialmodelingprep.com/stable/search-exchange-variants?symbol=AAPL

Parameters

Query Parameter

Type

Example

symbol*

string

AAPL

(*) Required
Response
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
32
33
34
35
36
37
38
39
40
[
	{
		"symbol": "AAPL",
		"price": 225.46,
		"beta": 1.24,
		"volAvg": 54722288,
		"mktCap": 3427916386000,
		"lastDiv": 1,
		"range": "164.08-237.23",
		"changes": -7.54,
		"companyName": "Apple Inc.",
		"currency": "USD",
		"cik": "0000320193",
		"isin": "US0378331005",
		"cusip": "037833100",
		"exchange": "NASDAQ Global Select",
		"exchangeShortName": "NASDAQ",
		"industry": "Consumer Electronics",
		"website": "https://www.apple.com",
		"description": "Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide. The company offers iPhone, a line of smartphones; Mac, a line of personal computers; iPad, a line of multi-purpose tablets; and wearables, home, and accessories comprising AirPods, Apple TV, Apple Watch, Beats products, and HomePod. It also provides AppleCare support and cloud services; and operates various platforms, including the App Store that allow customers to discov...",
		"ceo": "Mr. Timothy D. Cook",
		"sector": "Technology",
		"country": "US",
		"fullTimeEmployees": "161000",
		"phone": "408 996 1010",
		"address": "One Apple Park Way",
		"city": "Cupertino",
		"state": "CA",
		"zip": "95014",
		"dcfDiff": 62.45842,
		"dcf": 161.68157666868984,
		"image": "https://financialmodelingprep.com/image-stock/AAPL.png",
		"ipoDate": "1980-12-12",
		"defaultImage": false,
		"isEtf": false,
		"isActivelyTrading": true,
		"isAdr": false,
		"isFund": false
	}
]

