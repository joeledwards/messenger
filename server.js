/*
TODO: FEATURES
- persist their user's alias via a cookie
- allow users to send private messages to another user
  (this should be unified with the main chat window, but identfied as private)
  (private messaging should be opt-in)
- add simple account support (username and passphrase)
- allow users to set up private group sessions
  (only invited users can join a group session)
- add the ability to filter by
  - message content
  - message source (broadcast, client, group)
- add ability to clear all or historical messages before a certain age
- add a mechanism for exporting a log? perhaps private messages only?

TODO: TESTING
- build a test system which verifies session behavior acts as expected
  (should be a multi-client system that can message itself, and each site knows
   what to expect during correct operation)
*/

var node_static = require('node-static');
var parse_args = require('minimist');
var io = require('socket.io');
var redis = require('redis');
var http = require('http');
var b64 = require('b64');
var _ = require('lodash');

var broadcast_channel = "messages";
var key_client_stats = "client-stats";
var key_client_map_prefix = "client-info-";

var args = parse_args(process.argv.slice(2));

var debug = "d" in args;
var http_port = "http_port" in args ? args.http_port : 8080;
var redis_host = "redis_host" in args ? args.redis_host : '10.0.0.169';
var redis_port = "redis_port" in args ? args.redis_port :  6379;
var redis_auth = "redis_auth" in args ? args.redis_auth : 'Fzt3Gksr4P1U-oiHpAyriz_cvY8HV-4ZARql4GjzQX8=';

console.log("Debug mode:", debug);
console.log("Redis host:", redis_host);
console.log("Redis port:", redis_port);
console.log("Redis auth:", redis_auth);

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
var file_server = new node_static.Server('./www');

console.log("Resources have been loaded.", b64.encode('Joel Edwards'));

var server = http.createServer(function(request, response)
{
    request.addListener('end', function()
    {
        file_server.serve(request, response);   
    }).resume();
});

io.listen(server).sockets.on('connection', function(socket)
{
	console.log("connection established");

    var client_key;
    var client_id;
    var client_alias;
    var red;
    var direct_chanel;

	g_red.incr('last-client-id', function(error, buffer)
    {
		client_id = buffer;
        client_alias = b64.encode("" + client_id);
        client_key = key_client_map_prefix + client_id;
		red = makeRedisClient();
		direct_channel = 'client-' + client_id;

        socket.emit('welcome', { client_id : client_id });

		console.log("client id: " + buffer);

        // Log all channel subscribe actions
		red.on('psubscribe', function(pattern, count)
        {
			console.log("client " + client_id
					+ " subscribed to channel(s) matching \"" + pattern
					+ "\" (" + count + " total subscriptions)");
		});

        // Forward all pub/sub channel messages to the socket
		red.on('pmessage', function(pattern, channel, message)
        {
			var parsed = JSON.parse(message);
			console.log("Message from " + channel + ": " + parsed);
			socket.emit('message', parsed);
		});

        // Log all channel un-subscribe actions
		red.on('punsubscribe', function(pattern, count)
        {
			console.log("client " + client_id
					+ " un-subscribed to channel(s) matching \"" + pattern
					+ "\" (" + count + " total subscriptions)");
		});

        // Subscribe to pub/sub channels
		red.psubscribe(broadcast_channel, direct_channel);

        // Send welcome message to the client. Cannot send through Redis as it may not
        // yet be fully set up.
        socket.emit('message', {
            from : 0,
            alias : b64.encode("server"),
            body : b64.encode("Welcome client " + client_id)
        });
	});

	socket.on('broadcast', function(data)
    {
		console.log("Broadcast message: " + b64.decode(data.body));

        g_red.publish(broadcast_channel, JSON.stringify({
            from : client_id,
            alias : client_alias,
            body : data.body
        }));
	});

    // Handshake hash should have mappings of source clients to destination clients.
    // The one initiating the "handshake" gets automatically added (initiator, invitee)
    // When the invitee acttpts the reverse gets added (invitee, initiator)
    // There should be a way to throttle the number of invites (perhaps once every minute?
	socket.on('direct', function(data)
    {
		console.log("Direct message to client " + data.recipient + ": "
            + b64.decode(data.body));

		g_red.publish('client-' + data.recipient, JSON.stringify({
            from : client_id,
            alias : client_alias,
            body : data.body
        }));
	});

    socket.on('alias', function(data)
    {
        console.log("client " + client_id + " alias request: " + data);
        var new_alias = data.alias;

        // Attempt to set the alias of the client
        g_red.hsetnx("client-alias-hash", new_alias, client_id, function(err, result)
        {
            g_red.hget("client-id-hash", client_id, function(err, old_alias)
            {
                if (!err && old_alias)
                {
                    g_red.hdel("client-alias-hash", old_alias, function(err, result)
                    {
                        if (!err && result)
                        {
                            console.log("client " + client_id + " has been disassociated"
                                + " from alias '" + b64.decode(old_alias) + "'");
                        }
                    });
                }
            });

            g_red.hget("client-alias-hash", new_alias, function(err, alias_owner)
            {
                if (!err && client_id == alias_owner)
                {
                    console.log("client " + client_id + " has been associated with alias '"
                        + b64.decode(new_alias) + "'");

                    // If the alias was set, store the alias in the reverse hash
                    var old_alias = client_alias;
                    client_alias = new_alias;
                    g_red.hset("client-id-hash", client_id, client_alias);
                    socket.emit('alias', { alias : client_alias });

                    g_red.publish(broadcast_channel, JSON.stringify({
                        from : 0,
                        alias : b64.encode("server"),
                        body : b64.encode("Client " + client_id + " has changed alias from '"
                            + b64.decode(old_alias) + "' to '" + b64.decode(new_alias) + "'")
                    }));
                }
                else
                {
                    console.log("client " + client_id + " requested alias '"
                        + b64.decode(new_alias)
                        + "', but it was already in use by client " + alias_owner);

                    // If the alias could not be set, inform the requesting client
                    socket.emit('message', {
                        from : 0,
                        alias : b64.encode("server"),
                        body : b64.encode("Alias '" + b64.decode(new_alias)
                            + "' is already in use")
                    });
                }
            });
        });
    });

	socket.on('disconnect', function()
    {
		console.log("client " + client_id + " disconnected");
		red.punsubscribe();
		red.end();

        g_red.hget("client-alias-hash", client_id, function(err, alias)
        {
            if (!err)
            {
                console.log("dissassociating client " + client_id + " from alias '"
                    + alias + "'");

                g_red.hdel("client-alias-hash", alias);
                g_red.hdel("client-alias-hash", client_id);
            }
        });
	});
});

console.log("Listening on port", http_port);
server.listen(http_port);

