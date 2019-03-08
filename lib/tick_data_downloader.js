const moment = require('moment');
const fs = require('fs');
var firebase = require('./firebase_connect');
var spotware_api = require('./spotware_api');

// create a stdout and file logger
const log = require('simple-node-logger').createSimpleLogger('./logs/tick_data_downloader.log');

//a dictionary of all the active accounts downloading data, the key is the ctrader account id
var active_ctrader_recorders = {};

//a queue of all the https requests to send to the spotware api
var tick_requests = [];

var convertArrayOfObjectsToCSV = function (data) {
    var result, ctr, keys, columnDelimiter, lineDelimiter;

    if (data == null || !data.length) {
        return null;
    }

    columnDelimiter = ',';
    lineDelimiter = '\n';

    keys = Object.keys(data[0]);

    result = '';

    data.forEach(function(item) {
        ctr = 0;
        keys.forEach(function(key) {
            if (ctr > 0) result += columnDelimiter;

            result += item[key];
            ctr++;
        });
        result += lineDelimiter;
    });

    return result;
};

var write_day_ticks = function(data_details, ticks) {
    var csvContent = convertArrayOfObjectsToCSV(ticks);

    var dir = "data";
    var filename = data_details.account_id + "_" + data_details.symbol + "_" + data_details.bid_ask + "_" + data_details.date + ".csv";

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    fs.writeFile(dir + "/" + filename, csvContent, function(err) {
        if(err) {
            return log.error(err);
        }

        log.info("The " + filename + " was saved!");

        //Upload the file to the cloud
        var destination = 'data/' + data_details.account_id + '/' + data_details.symbol +'/' +
            data_details.bid_ask + '/' + data_details.date +'.csv';
        var source = './' + dir + "/" + filename;

        log.info("Uploading " + source);

        firebase.upload_day_ticks(source, destination, log.info, log.error);
    });
};

var tick_data_received = function(data, tick_request) {

    var tick_key = tick_request.symbol + "_" + tick_request.bid_ask + "_" + tick_request.date;

    //make sure this account is still active
    if(tick_request.account_id in active_ctrader_recorders) {

        //get the active user tick dictionary where the ticks are being stored
        var account = active_ctrader_recorders[tick_request.account_id];

        if (data.length > 0) {


            //get the most recent tick time from the data
            var recent_tick = moment(Math.max.apply(Math, data.map(function (o) {
                return o.timestamp;
            }))).utc();
            var oldest_tick = moment(Math.min.apply(Math, data.map(function (o) {
                return o.timestamp;
            }))).utc();

            //create the from time based on the last tick in hours, minutes and seconds
            var to_time = oldest_tick.format("HHmmss");

            //update the tick request based on the most recent one
            tick_request.to_time = to_time;

            log.debug("First tick: " + oldest_tick.format("YYYY-MM-DD HH:mm:ss") + ", last tick: " + recent_tick.format("YYYY-MM-DD HH:mm:ss") + ", total ticks: " + data.length);

            //record the ticks here so we can save them to google drive when the day is complete

            if (!account.ticks.hasOwnProperty(tick_key)) {
                account.ticks[tick_key] = data;
            }
            else
                account.ticks[tick_key] = account.ticks[tick_key].concat(data);

            log.info("Stored tick count for " + tick_key + ": " + account.ticks[tick_key].length);

            if (tick_request.to_time != '000000')
                tick_requests.push(tick_request);


        }
        if (data.length == 0 || tick_request.to_time == '000000') {

            //only do this for historic data
            if(account  && tick_key in account.ticks && moment(tick_request.date) < moment().utc()) {
                var ticks = account.ticks[tick_key];
                var tr_copy = JSON.parse(JSON.stringify(tick_request));
                write_day_ticks(tr_copy, ticks);
                delete account.ticks[tick_key];
            }

            var curr_date = moment(tick_request.date);
            var stop_date = moment(tick_request.stop_at);
            if (curr_date > stop_date) {

                //step back one day and keep going
                tick_request.date = curr_date.add(-1, "days").format("YYYYMMDD");

                //keep going if already downloaded
                while(account.downloaded_dates[tick_request.symbol + "_" + tick_request.bid_ask].includes(tick_request.date)) {
                    console.log('skipping ' + tick_request.symbol + ' ' + tick_request.date + ' ' + tick_request.bid_ask);
                    tick_request.date = moment(tick_request.date).add(-1, "days").format("YYYYMMDD");
                }

                tick_request.from_time = '000000';
                tick_request.to_time = '235959';
                tick_requests.push(tick_request);
            }
        }
    }

    //keep the tick requester loop going
    tick_requester();

};

var user_added = function(data) {

    //store the account info in a dictionary with teh account id as the key
    active_ctrader_recorders[data.account_id] = data;

    //create a new ticks property that is a dictionary of all the ticks that have been downloaded and not yet saved to file
    active_ctrader_recorders[data.account_id].ticks = {};

    //create a dictionary to save an array of already downloaded dates
    active_ctrader_recorders[data.account_id].downloaded_dates = {};

    log.info("Active cTrader Recorder found: " + JSON.stringify(data));

    var yesterday = moment().utc().add(-1, 'days');

    //TODO: instead of starting at yesterday start at the last date that was pushed to google drive (stored in active trader record in firebase) yesterday if this is null
    //start the first tick request
    request_ticks_for_account(active_ctrader_recorders[data.account_id], yesterday.format("YYYYMMDD"), '20140101');

};

var resubmit_tick_request = function(tick_request)
{
    //wait 5 seconds before resubmitting a request because the spotware api may have received too many requests
    setTimeout(function() {
        tick_requests.push(tick_request, 5000);
    });

    //keep the loop going
    tick_requester();
};

var tick_requester = function() {

    //an infinte loop that runs through all the tick requests and performs the request action
//if there are no requests there is a 5 second delay before checking the request queue again

    if(tick_requests.length == 0) {
        log.info("No requests, waiting 5 seconds");
        setTimeout(tick_requester, 5000);
    }
    else
    {

        //dequeue the oldest request from the array
        var tick_request = tick_requests.shift();

        if('submits' in tick_request && tick_request.submits > 10)
        {
            tick_requester();
        }
        else {

            log.info("Sending request: " + JSON.stringify(tick_request));

            //send the https request to the spotware api - the on_success function needs to call the tick_requested function
            //again on completion so that the next request can be sent
            try {
                spotware_api.request_tick_data(tick_request, tick_data_received, report_error, resubmit_tick_request);
            }
            catch (err) {
                //display error but keep the tick_requester loop running
                report_error(err.message);
                tick_requester();
            }
        }
    }
};


var run_on_new_day = function(function_to_run)
{
    //this will run the passed function at the start of a new UTC day

    var now = moment().utc();
    var milliseconds_until_new_day = 86400000 - ((now.hour() * 60 * 60 * 1000) + (now.minute() * 60 * 1000) + (now.second() * 1000) + now.millisecond());
    setTimeout(function_to_run, milliseconds_until_new_day + 60000);
};

var request_ticks_for_account = function(account, date, stop_at, includeAsk = true) {
    //start requesting ticks for this account
    //will start from date and keep downloading ticks until stop_at date is reached

    account.symbols.forEach(function(symbol) {


        firebase.get_downloaded("data/" + account.account_id + "/" + symbol + "/bid/", function (downloaded_dates) {

            //save the downloaded dates under the account object
            account.downloaded_dates[symbol + "_bid"] = downloaded_dates;

            var bid_date = date;

            while (account.downloaded_dates[symbol + "_bid"].includes(bid_date)) {
                console.log('skipping ' + symbol + " " + bid_date+ " bid");
                bid_date = moment(bid_date).add(-1, "days").format("YYYYMMDD");
            }

            var tick_request_bid = {
                account_id: account.account_id,
                symbol: symbol,
                bid_ask: 'bid',
                date: bid_date,
                from_time: '000000',
                to_time: '235959',
                oauth_token: account.oauth_token,
                stop_at: stop_at
            };
            tick_requests.push(tick_request_bid);
        }, log.error);

        if (includeAsk) {
            firebase.get_downloaded("data/" + account.account_id + "/" + symbol + "/ask/", function (downloaded_dates) {

                //save the downloaded dates under the account object
                account.downloaded_dates[symbol + "_ask"] = downloaded_dates;

                var ask_date = date;

                while (account.downloaded_dates[symbol + "_ask"].includes(ask_date)) {
                    console.log('skipping ' + symbol + " " + ask_date + " ask");
                    ask_date = moment(ask_date).add(-1, "days").format("YYYYMMDD");
                }

                var tick_request_ask = {
                    account_id: account.account_id,
                    symbol: symbol,
                    bid_ask: 'ask',
                    date: ask_date,
                    from_time: '000000',
                    to_time: '235959',
                    oauth_token: account.oauth_token,
                    stop_at: stop_at
                };

                tick_requests.push(tick_request_ask);
            }, log.error);
        }




    });

};

var new_day_requester = function() {
    //at the start of a new day tick requests for each user get added to the queue to get all data for the recently finished day

    var yesterday = moment().utc().add(-1, 'days').format("YYYYMMDD");
    var day_before = moment().utc().add(-2, 'days').format("YYYYMMDD");

    log.info("Adding tick data requests to queue for " + yesterday);

    //go through each active account and add yesterdays tick requests to the queue
    active_ctrader_recorders.forEach(function(account) {

        //just add yesterdays ticks only so date and stop_at should be the same date
        request_ticks_for_account(account, yesterday, yesterday);

        //loop through all other ticks and see if there are any from the day before because we will need to upload them
        Object.keys(account.ticks).forEach(function(tick_key) {

            //only do the day before ticks because other days may have not finished downloading
            if(day_before in tick_key) {
                var ticks = account.ticks[tick_key];

                var parts = tick_key.split('_');
                var symbol = parts[0];
                var bid_ask = parts[1];
                var date = parts[2];

                write_day_ticks({
                    account_id: account.account_id,
                    symbol: symbol,
                    bid_ask: bid_ask,
                    date: date
                }, ticks);

                delete account.ticks[tick_key];
            }
        });



    });

    //again setup the timer to run this function 1 second after the new day has started
    run_on_new_day(new_day_requester);
};

var start = function() {

    log.info("Started");

    //start listening for requests to record tick data
    firebase.start(user_added);

    //start the tick requester loop that will send the https requests from the tick_requests array or loop and wait if no
    //tick requests have been generated yet.
    var max_simultaneous_requests = 2;
    for(var i=0; i < max_simultaneous_requests; i++)
        tick_requester();

    //setup the timer to run 1 second after the new day has started - this adds the previous days history requests to the queue
    run_on_new_day(new_day_requester);
};

var report_error = function(message) {
  log.error(message);
};

module.exports = {
    start: start
};