var Q = require('q'); 
var redis = require('redis'); 

module.exports = {
    redis : function(config) {
        var deferred = Q.defer();
	    var client = redis.createClient(config.port, config.host);

        if (config.auth)
            client.auth(config.auth, function(error, reply)
            {
                if (error)
                    deferred.reject(error);
                else
                    deferred.resolve(client);
            });
        else
            deferred.resolve(client);

        return deferred.promise;
    }
};
