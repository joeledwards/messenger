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

var _ = require('lodash');
var Q = require('q');
var FS = require('fs');
var io = require('socket.io');
var b64 = require('b64');
var http = require('http');
var Redis = require('ioredis');
var node_static = require('node-static');

var config = require('./js/mods/config');
var db = require('./js/mods/db');

var BROADCAST_CHANNEL = "messages";
var KEY_CLIENT_STATS = "client-stats";
var KEY_CLIENT_MAP_PREFIX = "client-info-";

var configFile = 'config.json';
var config = JSON.parse(FS.readFileSync(configFile));
var redis = new Redis(config.redis);

var fileServer = new node_static.Server('./www');
var server = http.createServer(function (request, response) {
  request.addListener('end', function () {
    fileServer.serve(request, response);
  })
  .resume();
});

var bindPort = config.server.bind_port;
console.log("Listening on port", bindPort);
server.listen(bindPort);

console.log("Resources have been loaded.", b64.encode('Joel Edwards'));

var handleConnect = function (socket) {
  console.log("connection established");

  redis.incr('last-client-id')
  .then(function (clientId) {
    socket.emit('welcome', { client_id : clientId });
    console.log("Client", clientId, "joined the server.");
    var clientRedis = new Redis(config.redis);

    return {
      clientId: clientId,
      redis: clientRedis
    };
  })
  .then(function (context) {
    var clientId = context.clientId;
    var client_alias = b64.encode("" + clientId);
    var client_key = KEY_CLIENT_MAP_PREFIX + clientId;

    // Log all channel subscribe actions
    context.redis.on('psubscribe', function (pattern, count)
    {
      console.log("client " + clientId + 
          " subscribed to channel(s) matching \"" + pattern + 
          "\" (" + count + " total subscriptions)");
    });

    // Forward all pub/sub channel messages to the socket
    context.redis.on('pmessage', function (pattern, channel, message)
    {
      var parsed = JSON.parse(message);
      console.log("Message from " + channel + ": " + parsed);
      socket.emit('message', parsed);
    });

    // Log all channels un-subscribe actions
    context.redis.on('punsubscribe', function (pattern, count)
    {
      console.log("client " + clientId + 
          " un-subscribed from channel(s) matching \"" + pattern + 
          "\" (" + count + " total subscriptions)");
    });

    socket.on('disconnect', function ()
    {
      console.log("client " + clientId + " disconnected");
      context.redis.punsubscribe("*");

      context.redis.hget("client-alias-hash", clientId)
      .then(function (alias) {
        console.log("dissassociating client " + clientId + " from alias '" + alias + "'");

        return context.redis.hdel("client-alias-hash", alias);
      })
      .then(function () {
        return context.redis.hdel("client-alias-hash", clientId);
      })
      .then(function () {
        context.redis.disconnect();
      })
      .catch(function (error) {
        console.log("Error disassociating client " + clientId + " from alias '" + alias + "': " + error);
      });
    });

    var direct_channel = 'client-' + clientId;

    // Subscribe to pub/sub channels
    context.redis.psubscribe(BROADCAST_CHANNEL, direct_channel, function (error, count) {
      if (error) {
        console.log("Error subscribing to channels:", error);
      } else {
        console.log("[client-" + clientId + "] Subscribed to " + count + " channels.");
      }
    });

    socket.on('broadcast', function (data)
    {
      console.log("Broadcast message: " + b64.decode(data.body));

      context.redis.publish(BROADCAST_CHANNEL, JSON.stringify({
        from: clientId,
        alias: client_alias,
        body: data.body
      }));
    });

    // Handshake hash should have mappings of source clients to destination clients.
    // The one initiating the "handshake" gets automatically added (initiator, invitee)
    // When the invitee acttpts the reverse gets added (invitee, initiator)
    // There should be a way to throttle the number of invites 
    // (perhaps once every minute?)
    socket.on('direct', function (data) {
      console.log("Direct message to client " + data.recipient + ": " + 
          b64.decode(data.body));

      context.redis.publish('client-' + data.recipient, JSON.stringify({
        from: clientId,
        alias: client_alias,
        body: data.body
      }));
    });


    socket.on('alias', function (data)
    {
      console.log("client " + clientId + " alias request: " + data);
      var new_alias = data.alias;

      // Attempt to set the alias of the client
      context.redis.hsetnx("client-alias-hash", new_alias, clientId)
      .then(function (aliasUpdated) {
        if (aliasUpdated == 0) { // alias already set
          console.log("client " + clientId + " requested alias '" + 
              b64.decode(new_alias) + "', but it was already in use by client " + 
              alias_owner);

          // If the alias could not be set, inform the requesting client
          socket.emit('message', {
              from : 0,
              alias : b64.encode("server"),
              body : b64.encode("Alias '" + b64.decode(new_alias) + 
                  "' is already in use")
          });
        } 
        else { // new alias set
          console.log("client " + clientId + " has been associated with alias '" + b64.decode(new_alias) + "'");

          // If the alias was set, store the alias in the reverse hash
          var old_alias = client_alias;
          client_alias = new_alias;
          context.redis.hset("client-id-hash", clientId, client_alias)
          .then(function () {
            return context.redis.publish(BROADCAST_CHANNEL, JSON.stringify({
              from: 0,
              alias: b64.encode("server"),
              body: b64.encode("Client " + clientId + " has changed alias from '" + 
                  b64.decode(old_alias) + "' to '" + b64.decode(new_alias) + "'")
            }));
          }).then(function () {
            socket.emit('alias', { alias : client_alias });
            return context;
          }).then(function () {
            return context.redis.hget("client-id-hash", clientId)
          })
          .then(function (old_alias) {
            if (old_alias) {
              context.redis.hdel("client-alias-hash", old_alias)
              .then(function (result) {
                console.log("client " + clientId + " has been disassociated" + 
                    " from alias '" + b64.decode(old_alias) + "'");
              });
            }
          })
          .catch(function (error) {
            console.log("Error updating client alias:", error, "\nStack:\n", error.stack);
          });
        }
      });
    });

    // Send welcome message to the client. Cannot send through Redis as it may not
    // yet be fully set up.
    socket.emit('message', {
        from : 0,
        alias : b64.encode("server"),
        body : b64.encode("Welcome client " + clientId)
    });
  })
  .catch(function (error) {
    console.log("Error:", error, "\nStack:\n", error.stack);
  });
};

io(server).on('connection', handleConnect);

