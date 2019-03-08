var admin = require("firebase-admin");
const fs = require('fs');

var serviceAccount = require("../creds/firestore-creds.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://quant-black-server.firebaseio.com",
    storageBucket: "quant-black-server.appspot.com"
});

//config for google cloud storage
var config = {
    projectId: 'quant-black-server',
    keyFilename: './creds/firestore-creds.json'
};
var gcloud = require('@google-cloud/storage');
var storage = new gcloud.Storage(config);
var bucket = storage.bucket('quant-black-server.appspot.com');

// Initialize Cloud Firestore through Firebase admin
var db = admin.firestore();

var start = function(user_added, user_modified, user_removed) {

    //listen for active_recorders in the firestore database
    //these documents are added when a user has setup a new recorder to start recording the tick data
    db.collection("ctrader_active_recorders")
        .onSnapshot(function (querySnapshot) {
            querySnapshot.docChanges().forEach(function (change) {

                //run the passed callbacks on either added, modified or removed events
                if (change.type === "added")
                    if(user_added) user_added(change.doc.data());
                else if (change.type === "modified")
                    //#TODO What happens if a user modifies the symbol list ect..
                    ;
                else if (change.type === "removed")
                    //#TODO What happens if a active recorder is deleted
                    ;
            });
        });
};

var get_downloaded = function(source, on_complete, on_error) {

    bucket.getFiles({ prefix: source, delimiter: '/' }, function(err, files) {

        if(err)
        {
            if(on_error) on_error(err);
        }
        else {

            var downloaded_dates = [];

            if (files) {
                files.forEach(function (file) {
                    var parts = file.name.split('/');
                    if (parts.length > 0) {
                        var filename = parts[parts.length - 1];
                        var parts2 = filename.split(".");
                        if (parts2.length > 0) {
                            var date = parts2[0];
                            downloaded_dates.push(date);
                        }
                    }
                });
            }

            if (on_complete) on_complete(downloaded_dates);
        }
    });
};

var upload_day_ticks = function(source, destination, on_success, on_error) {


    const options = {
        destination: destination
    };

    bucket.upload(source, options, function(err) {
        if(err) on_error(err);
        else {
            on_success(destination + " upload success.");

            //delete the file from local storage
            fs.unlink(source, (err) => {
                if (err) on_error(err);
                else
                    console.log(source + " removed from local.");
            });

        };

    });

};



module.exports = {
    start: start,
    upload_day_ticks: upload_day_ticks,
    get_downloaded: get_downloaded
};
