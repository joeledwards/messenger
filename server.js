var redis_host = '10.0.0.169';
var redis_port = 6379;
var redis_auth = 'Fzt3Gksr4P1U-oiHpAyriz_cvY8HV-4ZARql4GjzQX8=';
var io = require('socket.io').listen(8888);
var redis = require('redis');
var b64 = require('b64');
var broadcast_channel = "messages";

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

io.sockets.on('connection', function (socket)
{
    console.log("connection established");

    var client_id = g_red.incr('last-client-id');
    var red = makeRedisClient();
    var direct_channel = 'client-' + client_id;

    red.on('psubscribe', function(pattern, count)
    {
        console.log("client " + client_id + " subscribed to channel(s) matching \"" + pattern
            + "\" (" + count + " total subscriptions)");
    });

    red.on('pmessage', function(pattern, channel, message)
    {
        console.log("Message from " + channel + ": " + message);
        socket.emit('message', {
            encoding: "base64",
            body: b64.encode(message)
        });
    });

    red.on('punsubscribe', function(pattern, count)
    {
        console.log("client " + client_id + " un-subscribed to channel(s) matching \"" + pattern + "\" (" + count + " total subscriptions)");
    });

    red.psubscribe(broadcast_channel, direct_channel);

    socket.on('broadcast', function (data)
    {
        var message = (data.encoding === "base64") ? b64.decode(data.body) : data.body;
        console.log("Broadcast message: " + message);
        g_red.publish(broadcast_channel, b64.encode(data));
    });

    socket.on('direct', function (data)
    {
        var recipient = data.recipient;
        var message = (data.encoding === "base64") ? b64.decode(data.body) : data.body;
        console.log("Direct message to client " + recipient + ": " + message);
        g_red.publish('client-' + recipient, b64.encode(data));
    });

    socket.on('disconnect', function()
    {
        console.log("client " + client_id + " disconnected");
        red.punsubscribe();
        red.end();
    });

    //g_red.publish(direct_channel, "Welcome client " + client_id);
});
