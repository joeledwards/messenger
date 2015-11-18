var Q = require('q');
var FS = require('fs');

var readJson = function(configFile) {
    var deferred = Q.defer();

    FS.readFile(configFile, function(error, data) {
        if (error)
            deferred.reject(error);
        else
            deferred.resolve(JSON.parse(data));
    });

    return deferred.promise;
};

var fullConfig = function (configFile) {
    return readJson(configFile || 'config.json');
};

module.exports = {
    redis : function (configFile) {
        return fullConfig(configFile).then(function(config) {
            return config.redis;
        });
    }, 

    server : function (configFile) {
        return fullConfig(configFile).then(function(config) {
            return config.server;
        });
    },

    full : fullConfig
};
