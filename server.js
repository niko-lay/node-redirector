var conf = require('./lib/config');

var express = require('express');
var app = express();
var fs = require('fs');
var url = require('url');
var path = require('path');
var chokidar = require('chokidar');

// http://geolite.maxmind.com/download/geoip/database/GeoLite2-City.mmdb.gz
const MMDBReader = require('mmdb-reader');
var maxMindReader;
var isMaxMindInit = false;

var logger = require('mag')(conf.appName);


var appDir = path.dirname(require.main.filename);
// should be done synchronously
var configParams = JSON.parse(fs.readFileSync(appDir + '/data/config.json'));

var watcher = chokidar.watch (appDir + '/data/config.json', {persistent: true});
watcher.on('change', function(path, stats){
    fs.readFile(path, 'utf8', function(err, data){
        if (err){
            logger.w(`Failed to read new file ${path}. Using old config.`);
            return;
        }

        try {
            var tmpConfig = JSON.parse(data);
        }catch(e){
            logger.w (`Failed to parse new config ${path}. Error: '${e.message}'. Using old one.`);
            return;
        }

        if (tmpConfig){
            configParams = tmpConfig;
            logger.i(`New config params has been applied`);
        }else{
            logger.w (`Failed to parse new config ${path}. Using old one.`);
        }
    });
});

watcher.on('unlink', function(path){
    logger.w(`Config file ${path} has been deleted. Using old config until app restarts`);
});

function addNocache(resp){
    resp.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    resp.setHeader('Pragma', 'no-cache');
    resp.setHeader('Expires', '0');
};

var redirector = function(data, resp){
    if (!data){
        return resp.status(400).send('Request is wrong');
    }

    if (!data.hasOwnProperty('persistent')){
        return resp.status(400).send('Request is wrong');
    }

    if (!data.hasOwnProperty('url')){
        return resp.status(400).send('Request is wrong');
    }

    var redirectCode = (data.persistent)?301:302;

    resp.setHeader('Location', data.url);
    //resp.status(200).end('Redirecting to new location... '  + data.url); // for debug ;)
    resp.status(redirectCode).end('Redirecting to new location... '  + data.url);
}

var onReq = function(req, resp){
    addNocache(resp);

    var pathname = url.parse(req.url).pathname;
    if (!pathname){
        logger.i("Wrong request. No 'pathname' part. URL: " + req.url);
        return resp.status(400).send('Request is wrong');
    }

    var host = req.get('host').split(':')[0];
    var port = (!req.get('host').split(':')[1])?80:req.get('host').split(':')[1];
    var remoteIp = req.connection.remoteAddress;

    if (req.headers['x-real-ip']){
        remoteIp = req.headers['x-real-ip'];
    }

    var geo;
    if (isMaxMindInit){
        var ipData = maxMindReader.lookup(remoteIp);
        if (!ipData){
            geo = "No data for this IP";
        }else{
            var geoObj = Object.create(null);
            if (ipData.hasOwnProperty('location')){
                geoObj.lat = ipData.location.latitude;
                geoObj.lon = ipData.location.longitude;
            }
            if(ipData.hasOwnProperty('country')){
                geoObj.country = ipData.country.names.en;
                geoObj.country_code = ipData.country.iso_code;
            }
            if (ipData.hasOwnProperty('city')){
                geoObj.city = ipData.city.names.en;
            }
            geo = JSON.stringify(geoObj);
        }
    }else{
        geo = 'Not init yet';
    }

   logger.i(`|${remoteIp}|${geo}|${req.headers['user-agent']}|${req.headers['accept-language']}|${host}|${pathname}`);

    if (!configParams.hasOwnProperty(host)){
        return resp.status(400).send('Request is wrong');
    }


    if (configParams[host].hasOwnProperty(pathname)){
        return redirector(configParams[host][pathname], resp);
    }else {
        return redirector(configParams[host]['default'], resp);
    }

    return resp.status(400).send('Request is wrong');
};

app.disable('x-powered-by');
app.set('etag', false);

app.get('*', onReq);
app.on ('error', (err) => {
    logger.warn(err);
});

try {
    maxMindReader = new MMDBReader(appDir + '/data/GeoLite2-City.mmdb');
    isMaxMindInit = true;

    logger.i('maxMindReader initialisation complete');
}catch(err){
    logger.warning("Maxmind initialisation failed. Reason: " + err.message);
}

var server = app.listen(conf.listenPort, conf.listenIP, function () {
    var host = server.address().address;
    var port = server.address().port;

    logger.info('Server listening at http://%s:%s', host, port);
});

server.on ('error', function(e){
    logger.e(`Error happens: ${e.message}`);
    process.exit(1);
});
