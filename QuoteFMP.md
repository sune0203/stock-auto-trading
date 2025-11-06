Quote
Stock Quote API
Globe Flag
Access real-time stock quotes with the FMP Stock Quote API. Get up-to-the-minute prices, changes, and volume data for individual stocks.

Endpoint:

https://financialmodelingprep.com/stable/quote?symbol=AAPL

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
[
	{
		"symbol": "AAPL",
		"name": "Apple Inc.",
		"price": 232.8,
		"changePercentage": 2.1008,
		"change": 4.79,
		"volume": 44489128,
		"dayLow": 226.65,
		"dayHigh": 233.13,
		"yearHigh": 260.1,
		"yearLow": 164.08,
		"marketCap": 3500823120000,
		"priceAvg50": 240.2278,
		"priceAvg200": 219.98755,
		"exchange": "NASDAQ",
		"open": 227.2,
		"previousClose": 228.01,
		"timestamp": 1738702801
	}
]

Stock Quote Short API
Globe Flag
Get quick snapshots of real-time stock quotes with the FMP Stock Quote Short API. Access key stock data like current price, volume, and price changes for instant market insights.

Endpoint:

https://financialmodelingprep.com/stable/quote-short?symbol=AAPL

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
[
	{
		"symbol": "AAPL",
		"price": 232.8,
		"change": 4.79,
		"volume": 44489128
	}
]

Aftermarket Trade API
USA Flag
Track real-time trading activity occurring after regular market hours with the FMP Aftermarket Trade API. Access key details such as trade prices, sizes, and timestamps for trades executed during the post-market session.

Endpoint:

https://financialmodelingprep.com/stable/aftermarket-trade?symbol=AAPL

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
[
	{
		"symbol": "AAPL",
		"price": 232.53,
		"tradeSize": 132,
		"timestamp": 1738715334311
	}
]

Aftermarket Quote API
USA Flag
Access real-time aftermarket quotes for stocks with the FMP Aftermarket Quote API. Track bid and ask prices, volume, and other relevant data outside of regular trading hours.

Endpoint:

https://financialmodelingprep.com/stable/aftermarket-quote?symbol=AAPL

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
[
	{
		"symbol": "AAPL",
		"bidSize": 1,
		"bidPrice": 232.45,
		"askSize": 3,
		"askPrice": 232.64,
		"volume": 41647042,
		"timestamp": 1738715334311
	}
]

Stock Price Change API
Globe Flag
Track stock price fluctuations in real-time with the FMP Stock Price Change API. Monitor percentage and value changes over various time periods, including daily, weekly, monthly, and long-term.

Endpoint:

https://financialmodelingprep.com/stable/stock-price-change?symbol=AAPL

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
[
	{
		"symbol": "AAPL",
		"1D": 2.1008,
		"5D": -2.45946,
		"1M": -4.33925,
		"3M": 4.86014,
		"6M": 5.88556,
		"ytd": -4.53147,
		"1Y": 24.04092,
		"3Y": 35.04264,
		"5Y": 192.05871,
		"10Y": 678.8558,
		"max": 181279.04168
	}
]

Stock Batch Quote API
Globe Flag
Retrieve multiple real-time stock quotes in a single request with the FMP Stock Batch Quote API. Access current prices, volume, and detailed data for multiple companies at once, making it easier to track large portfolios or monitor multiple stocks simultaneously.

Endpoint:

https://financialmodelingprep.com/stable/batch-quote?symbols=AAPL

Parameters

Query Parameter

Type

Example

symbols*

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
[
	{
		"symbol": "AAPL",
		"name": "Apple Inc.",
		"price": 232.8,
		"changePercentage": 2.1008,
		"change": 4.79,
		"volume": 44489128,
		"dayLow": 226.65,
		"dayHigh": 233.13,
		"yearHigh": 260.1,
		"yearLow": 164.08,
		"marketCap": 3500823120000,
		"priceAvg50": 240.2278,
		"priceAvg200": 219.98755,
		"exchange": "NASDAQ",
		"open": 227.2,
		"previousClose": 228.01,
		"timestamp": 1738702801
	}
]

Stock Batch Quote Short API
Globe Flag
Access real-time, short-form quotes for multiple stocks with the FMP Stock Batch Quote Short API. Get a quick snapshot of key stock data such as current price, change, and volume for several companies in one streamlined request.

Endpoint:

https://financialmodelingprep.com/stable/batch-quote-short?symbols=AAPL

Parameters

Query Parameter

Type

Example

symbols*

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
[
	{
		"symbol": "AAPL",
		"price": 232.8,
		"change": 4.79,
		"volume": 44489128
	}
]

Batch Aftermarket Trade API
USA Flag
Retrieve real-time aftermarket trading data for multiple stocks with the FMP Batch Aftermarket Trade API. Track post-market trade prices, volumes, and timestamps across several companies simultaneously.

Endpoint:

https://financialmodelingprep.com/stable/batch-aftermarket-trade?symbols=AAPL

Parameters

Query Parameter

Type

Example

symbols*

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
[
	{
		"symbol": "AAPL",
		"price": 232.53,
		"tradeSize": 132,
		"timestamp": 1738715334311
	}
]

Batch Aftermarket Quote API
USA Flag
Retrieve real-time aftermarket quotes for multiple stocks with the FMP Batch Aftermarket Quote API. Access bid and ask prices, volume, and other relevant data for several companies during post-market trading.

Endpoint:

https://financialmodelingprep.com/stable/batch-aftermarket-quote?symbols=AAPL

Parameters

Query Parameter

Type

Example

symbols*

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
[
	{
		"symbol": "AAPL",
		"bidSize": 1,
		"bidPrice": 232.45,
		"askSize": 3,
		"askPrice": 232.64,
		"volume": 41647042,
		"timestamp": 1738715334311
	}
]