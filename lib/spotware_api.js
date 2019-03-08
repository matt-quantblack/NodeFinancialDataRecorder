var https = require('https');

var c_trader_tick_data_url = "https://api.spotware.com/connect/tradingaccounts/{account_id}/symbols/{symbol}/{bid_ask}?date={date}&from={from_time}&to={to_time}&oauth_token={oauth_token}";


var request_tick_data = function(tick_request, on_success, on_error, resubmit) {

    if(!('account_id' in tick_request))
        throw new Error ("account_id is a required property of tick_request");
    if(!('symbol' in tick_request))
        throw new Error ("symbol is a required property of tick_request");
    if(!('bid_ask' in tick_request))
        throw new Error ("bid_ask is a required property of tick_request");
    if(!('date' in tick_request))
        throw new Error ("date is a required property of tick_request");
    if(!('from_time' in tick_request))
        throw new Error ("from_time is a required property of tick_request");
    if(!('to_time' in tick_request))
        throw new Error ("to_time is a required property of tick_request");
    if(!('oauth_token' in tick_request))
        throw new Error ("o_aut_token is a required property of tick_request");

    var url = c_trader_tick_data_url
        .replace('{account_id}', tick_request.account_id)
        .replace('{symbol}', tick_request.symbol)
        .replace('{bid_ask}', tick_request.bid_ask)
        .replace('{date}', tick_request.date)
        .replace('{from_time}', tick_request.from_time)
        .replace('{to_time}', tick_request.to_time)
        .replace('{oauth_token}', tick_request.oauth_token);

    https.get(url, (res) => {
        let data = '';

        // A chunk of data has been recieved.
        res.on('data', (chunk) => {
            data += chunk;
        });

        // The whole response has been received.
        res.on('end', () => {

            //parse into an object
            var tick_data = null;
            try {
                tick_data = JSON.parse(data);
            }
            catch(err)
            {
                if(on_error) on_error("Failed parsing json of spotware api download." + err);
            }

            //check if data was recieved or an error and run the appropriate callback
            if(tick_data != null && tick_data.hasOwnProperty('data')) {
                if (on_success) on_success(tick_data.data, tick_request);
                else if (tick_data.hasOwnProperty('error')) {
                    if (on_error) on_error(tick_data.error.description);
                    else if (on_error) on_error("Error: Bad response data.");
                    if(resubmit) resubmit(tick_request);
                }
            }
            else {
                if('submits' in tick_request)
                    tick_request.submits++;
                else
                    tick_request.submits = 1;
                if (resubmit) resubmit(tick_request);
            }

        });

    }).on("error", (err) => {
        var message = "Error: " + err.message;
        if(on_error) on_error(message);
        if(resubmit) resubmit(tick_request);
    });



};

module.exports = {
    request_tick_data : request_tick_data
};