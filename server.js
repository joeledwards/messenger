var io = require('socket.io').listen(80);
var redis = require('node-redis');
var g_red = redis.createClient();
var b64 = require('b64');
var broadcast_channel = "messages";

io.sockets.on('connection', function (socket)
{
    var client_id = g_red.incr('last-client-id');
    var red = redis.createClient();
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

    g_red.publish(direct_channel, "Welcome client " + client_id);
});
