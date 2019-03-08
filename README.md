# Cloud based Crypo, FOREX, Commodities Tick Recorder

Most trading applications only store the minute data and only the bid feed so it is difficult to get the high resolution tick data as well as the ask feed which allows for an accurate calculation of the spread.

This application records live bid and ask tick data from your forex broker using the cTrader API. The data is stored using google clound storage. This data can later be used for accurate backtesting of trading strategies.

This node version of the data recorded can be easily and cheaply run 24/7 as a web app on Heroku servers

## Installation

Clone the repository.

npm install

npm start

## Usage

- A cTrader API account needs to be created at connect.spotware.com
- Authorise the cTrader account by following the spotware documentation
- Create a Google firebase account
- Create a folder called creds and store the firebase service account credentials in this folder as firestore-creds.json
- Create a firestore database
- Create a collection in firestore named 'ctrader_active_recorders'
- Create a new document under this collection (a new one can be created for every user that wishes to use the application)
- The document must have the following fields:
  - account_id: This is the cTrader account id
  - oauth_refresh_token: from the authorised cTrader account
  - oauth_token: from the authorised cTrader account
  - symbols: array of symbol names to collect data for

## License
[MIT](https://choosealicense.com/licenses/mit/)
