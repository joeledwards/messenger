var redis_host = '10.0.0.169';
var redis_port = 6379;
var redis_auth = 'Fzt3Gksr4P1U-oiHpAyriz_cvY8HV-4ZARql4GjzQX8=';
var io = require('socket.io').listen(8888);
var redis = require('redis');
var b64 = require('b64');
var broadcast_channel = "messages";

var key_client_stats = "client-stats";
var key_client_map_prefix = "client-info-";

function makeRedisClient()
{
	var client = redis.createClient(redis_port, redis_host);
	client.auth(redis_auth, function(result)
	{
		console.log("created new redis client.");
	});

	return client;
}

var g_red = makeRedisClient();

console.log("Resources have been loaded.", b64.encode('Joel Edwards'));

io.sockets.on('connection', function(socket)
{
	console.log("connection established");

    var client_key;
    var client_id;
    var red;
    var direct_chanel;

	g_red.incr('last-client-id', function(error, buffer) {
		client_id = buffer;
        client_key = key_client_map_prefix + client_id;
		red = makeRedisClient();
		direct_channel = 'client-' + client_id;

        socket.emit('welcome', {
            client_id : client_id
        });

		console.log("client id: " + buffer);

		red.on('psubscribe', function(pattern, count) {
			console.log("client " + client_id
					+ " subscribed to channel(s) matching \"" + pattern
					+ "\" (" + count + " total subscriptions)");
		});

		red.on('pmessage', function(pattern, channel, message) {
			var parsed = JSON.parse(message);
			console.log("Message from " + channel + ": " + parsed);
			socket.emit('message', parsed);
		});

		red.on('punsubscribe', function(pattern, count) {
			console.log("client " + client_id
					+ " un-subscribed to channel(s) matching \"" + pattern
					+ "\" (" + count + " total subscriptions)");
		});

		red.psubscribe(broadcast_channel, direct_channel);

		g_red.publish(direct_channel, "Welcome client " + client_id);
	});

	socket.on('broadcast', function(data) {
		var message = (data.encoding === "base64") ? b64.decode(data.body)
				: data.body;
        var encodedMessage = b64.encode(message);
		console.log("Broadcast message: " + message);
		g_red.publish(broadcast_channel, JSON.stringify({
            from : client_id,
            encoding : "base64",
            body : encodedMessage
        }));
	});

	socket.on('direct', function(data) {
		var recipient = data.recipient;
		var message = (data.encoding === "base64") ? b64.decode(data.body)
				: data.body;
		console.log("Direct message to client " + recipient + ": " + message);
		g_red.publish('client-' + recipient, b64.encode(message));
	});

	socket.on('disconnect', function() {
		console.log("client " + client_id + " disconnected");
		red.punsubscribe();
		red.end();
	});
});
