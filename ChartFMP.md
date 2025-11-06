Charts
Stock Chart Light API
Globe Flag
Access simplified stock chart data using the FMP Basic Stock Chart API. This API provides essential charting information, including date, price, and trading volume, making it ideal for tracking stock performance with minimal data and creating basic price and volume charts.

Endpoint:

https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=AAPL

Parameters

Query Parameter

Type

Example

symbol*

string

AAPL


from

date

2025-06-10

to

date

2025-09-10

(*) Required | Maximum 5000 records per request
Response
[
	{
		"symbol": "AAPL",
		"date": "2025-02-04",
		"price": 232.8,
		"volume": 44489128
	}
]

Stock Price and Volume Data API
Globe Flag
Access full price and volume data for any stock symbol using the FMP Comprehensive Stock Price and Volume Data API. Get detailed insights, including open, high, low, close prices, trading volume, price changes, percentage changes, and volume-weighted average price (VWAP).

Endpoint:

https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=AAPL

Parameters

Query Parameter

Type

Example

symbol*

string

AAPL


from

date

2025-06-10

to

date

2025-09-10

(*) Required | Maximum 5000 records per request
Response
9
10
11
12
13
14
[
	{
		"symbol": "AAPL",
		"date": "2025-02-04",
		"open": 227.2,
		"high": 233.13,
		"low": 226.65,
		"close": 232.8,
		"volume": 44489128,
		"change": 5.6,
		"changePercent": 2.46479,
		"vwap": 230.86
	}
]

Unadjusted Stock Price API
Globe Flag
Access stock price and volume data without adjustments for stock splits with the FMP Unadjusted Stock Price Chart API. Get accurate insights into stock performance, including open, high, low, and close prices, along with trading volume, without split-related changes.

Endpoint:

https://financialmodelingprep.com/stable/historical-price-eod/non-split-adjusted?symbol=AAPL

Parameters

Query Parameter

Type

Example

symbol*

string

AAPL


from

date

2025-06-10

to

date

2025-09-10

(*) Required | Maximum 5000 records per request
Response
9
10
11
[
	{
		"symbol": "AAPL",
		"date": "2025-02-04",
		"adjOpen": 227.2,
		"adjHigh": 233.13,
		"adjLow": 226.65,
		"adjClose": 232.8,
		"volume": 44489128
	}
]

Dividend Adjusted Price Chart API
Globe Flag
Analyze stock performance with dividend adjustments using the FMP Dividend-Adjusted Price Chart API. Access end-of-day price and volume data that accounts for dividend payouts, offering a more comprehensive view of stock trends over time.

Endpoint:

https://financialmodelingprep.com/stable/historical-price-eod/dividend-adjusted?symbol=AAPL

Parameters

Query Parameter

Type

Example

symbol*

string

AAPL


from

date

2025-06-10

to

date

2025-09-10

(*) Required | Maximum 5000 records per request
Response
9
10
11
[
	{
		"symbol": "AAPL",
		"date": "2025-02-04",
		"adjOpen": 227.2,
		"adjHigh": 233.13,
		"adjLow": 226.65,
		"adjClose": 232.8,
		"volume": 44489128
	}
]

1 Min Interval Stock Chart API
Globe Flag
Access precise intraday stock price and volume data with the FMP 1-Minute Interval Stock Chart API. Retrieve real-time or historical stock data in 1-minute intervals, including key information such as open, high, low, and close prices, and trading volume for each minute.

Endpoint:

https://financialmodelingprep.com/stable/historical-chart/1min?symbol=AAPL

Parameters

Query Parameter

Type

Example

symbol*

string

AAPL


from

date

2024-01-01

to

date

2024-03-01

nonadjusted

boolean

false

(*) Required
Response
9
10
[
	{
		"date": "2025-02-04 15:59:00",
		"open": 233.01,
		"low": 232.72,
		"high": 233.13,
		"close": 232.79,
		"volume": 720121
	}
]

5 Min Interval Stock Chart API
Globe Flag
Access stock price and volume data with the FMP 5-Minute Interval Stock Chart API. Retrieve detailed stock data in 5-minute intervals, including open, high, low, and close prices, along with trading volume for each 5-minute period. This API is perfect for short-term trading analysis and building intraday charts.

Endpoint:

https://financialmodelingprep.com/stable/historical-chart/5min?symbol=AAPL

Parameters

Query Parameter

Type

Example

symbol*

string

AAPL


from

date

2024-01-01

to

date

2024-03-01

nonadjusted

boolean

false

(*) Required
Response
9
10
[
	{
		"date": "2025-02-04 15:55:00",
		"open": 232.87,
		"low": 232.72,
		"high": 233.13,
		"close": 232.79,
		"volume": 1555040
	}
]

15 Min Interval Stock Chart API
Globe Flag
Access stock price and volume data with the FMP 15-Minute Interval Stock Chart API. Retrieve detailed stock data in 15-minute intervals, including open, high, low, close prices, and trading volume. This API is ideal for creating intraday charts and analyzing medium-term price trends during the trading day.

Endpoint:

https://financialmodelingprep.com/stable/historical-chart/15min?symbol=AAPL

Parameters

Query Parameter

Type

Example

symbol*

string

AAPL


from

date

2024-01-01

to

date

2024-03-01

nonadjusted

boolean

false

(*) Required
Response
9
10
[
	{
		"date": "2025-02-04 15:45:00",
		"open": 232.25,
		"low": 232.18,
		"high": 233.13,
		"close": 232.79,
		"volume": 2535629
	}
]

30 Min Interval Stock Chart API
Globe Flag
Access stock price and volume data with the FMP 30-Minute Interval Stock Chart API. Retrieve essential stock data in 30-minute intervals, including open, high, low, close prices, and trading volume. This API is perfect for creating intraday charts and tracking medium-term price movements for more strategic trading decisions.

Endpoint:

https://financialmodelingprep.com/stable/historical-chart/30min?symbol=AAPL

Parameters

Query Parameter

Type

Example

symbol*

string

AAPL


from

date

2024-01-01

to

date

2024-03-01

nonadjusted

boolean

false

(*) Required
Response
9
10
[
	{
		"date": "2025-02-04 15:30:00",
		"open": 232.29,
		"low": 232.01,
		"high": 233.13,
		"close": 232.79,
		"volume": 3476320
	}
]

1 Hour Interval Stock Chart API
Globe Flag
Track stock price movements over hourly intervals with the FMP 1-Hour Interval Stock Chart API. Access essential stock price and volume data, including open, high, low, and close prices for each hour, to analyze broader intraday trends with precision.

Endpoint:

https://financialmodelingprep.com/stable/historical-chart/1hour?symbol=AAPL

Parameters

Query Parameter

Type

Example

symbol*

string

AAPL


from

date

2024-01-01

to

date

2024-03-01

nonadjusted

boolean

false

(*) Required
Response
9
10
[
	{
		"date": "2025-02-04 15:30:00",
		"open": 232.29,
		"low": 232.01,
		"high": 233.13,
		"close": 232.37,
		"volume": 15079381
	}
]

4 Hour Interval Stock Chart API
Globe Flag
Analyze stock price movements over extended intraday periods with the FMP 4-Hour Interval Stock Chart API. Access key stock price and volume data in 4-hour intervals, perfect for tracking longer intraday trends and understanding broader market movements.

Endpoint:

https://financialmodelingprep.com/stable/historical-chart/4hour?symbol=AAPL

Parameters

Query Parameter

Type

Example

symbol*

string

AAPL


from

date

2024-01-01

to

date

2024-03-01

nonadjusted

boolean

false

(*) Required
Response
9
10
[
	{
		"date": "2025-02-04 12:30:00",
		"open": 231.79,
		"low": 231.37,
		"high": 233.13,
		"close": 232.37,
		"volume": 23781913
	}
]

