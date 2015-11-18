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

require('log-a-log');

const FS = require('fs');
const WebSocketServer = require('ws').Server;
const b64 = require('b64');
const Redis = require('ioredis');
const express = require('express');

const config = require('./js/mods/config');

const BROADCAST_CHANNEL = "messages";
const KEY_CLIENT_STATS = "client-stats";
const KEY_CLIENT_MAP_PREFIX = "client-info-";

//const configFile = 'config.json';
//const config = JSON.parse(FS.readFileSync(configFile));

//const redis = new Redis(config.redis);
const redis = new Redis({
  host: 'redis',
  port: 6379
});

const app = express();

//var bindPort = config.server.bind_port;
var bindPort = 8080;

const wss = new WebSocketServer({server: app, path: "/messages"});

// A new client has connected, everything within the handler function
// is relevant to the newly connected client.
wss.on('connection', (ws) => {
  console.log("New connection opened.");

  // Get the next client ID from Redis
  redis.incr('last-client-id')

  // Setup the new client's context
  .then((clientId) => {
    console.log(`Client ${clientId} joined the server.`);

    // Send a welcome message to the new client containing their clientId
    socket.emit('welcome', { client_id : clientId });

    // Establish a dedicated Redis connection for this client
    var clientRedis = new Redis(config.redis);

    return {
      clientId: clientId,
      redis: clientRedis
    };
  })

  .then((context) => {
    console.log(`Context setup complete for client ${context.clientId}`);

    var clientId = context.clientId;
    var clientAlias = b64.encode("" + clientId);
    var client_key = KEY_CLIENT_MAP_PREFIX + clientId;

    // Log all channel subscribe actions
    context.redis.on('psubscribe', (pattern, count) => {
      console.log(`client ${clientId} subscribed to channel(s) matching "${pattern}" (${count} total subscriptions)`);
    });

    // Forward all pub/sub channel messages to the socket
    context.redis.on('pmessage', (pattern, channel, message) => {
      var parsed = JSON.parse(message);
      console.log(`Message from ${channel}: ${parsed}`);
      socket.emit('message', parsed);
    });

    // Log all channels un-subscribe actions
    context.redis.on('punsubscribe', (pattern, count) => {
      console.log(`client ${clientId} un-subscribed from channel(s) matching "${pattern}" (${count} total subscriptions)`);
    });

    // Handle client disconnects, ensuring to remove their profile from Redis
    socket.on('disconnect', () => {
      console.log(`client ${clientId} disconnected.`);

      // Unsubscribe from all channels
      context.redis.punsubscribe("*")

      // Determine whether the client had setup an alias
      .then((result) => {
        console.log(`Performing lookup on existing alias for client ${context.clientId}...`);

        return redis.hget("client-alias-hash", clientId);
      })

      // Remove the client alias
      .then((alias) => {
        console.log(`Dissassociating client ${clientId} from alias '${alias}'`);

        return redis.hdel("client-alias-hash", alias);
      })

      // Delete the reverse relation
      .then(() => redis.hdel("client-alias-hash", clientId))

      // Disconnecting Redis client
      .then(() => {
        console.log(`Disassociating client ${clientId}, disconnecting Redis client...`);

        context.redis.disconnect();
      })

      // Handle any errors with client cleanup
      .catch((error) => {
        console.log(`Error disassociating client ${clientId} from alias '${alias}': ${error}`);
      });
    });

    var directChannel = 'client-' + clientId;

    // Subscribe to pub/sub channels
    context.redis.psubscribe(BROADCAST_CHANNEL, directChannel)

    .then((count) => {
      console.log(`[client-${clientId}] Subscribed to ${count} channels.`);
    })

    .catch((error) => {
      console.log("Error subscribing to channels:", error);
    });

    socket.on('broadcast', (data) => {
      console.log("Broadcast message: " + b64.decode(data.body));

      context.redis.publish(BROADCAST_CHANNEL, JSON.stringify({
        from: clientId,
        alias: clientAlias,
        body: data.body
      }));
    });

    // Handshake hash should have mappings of source clients to destination clients.
    // The one initiating the "handshake" gets automatically added (initiator, invitee)
    // When the invitee acttpts the reverse gets added (invitee, initiator)
    // There should be a way to throttle the number of invites 
    // (perhaps once every minute?)
    socket.on('direct', (data) => {
      console.log(`Direct message to client ${data.recipient}: ${b64.decode(data.body)}`);

      context.redis.publish('client-' + data.recipient, JSON.stringify({
        from: clientId,
        alias: clientAlias,
        body: data.body
      }));
    });


    socket.on('alias', (data) => {
      console.log(`client ${clientId} alias request: ${data}`);
      var newAlias = data.alias;

      // Attempt to set the alias of the client
      context.redis.hsetnx("client-alias-hash", newAlias, clientId)
      .then((aliasUpdated) => {
        if (aliasUpdated == 0) { // alias already set
          console.log("client " + clientId + " requested alias '" + 
              b64.decode(newAlias) + "', but it was already in use by client " + 
              alias_owner);

          // If the alias could not be set, inform the requesting client
          socket.emit('message', {
              from : 0,
              alias : b64.encode("server"),
              body : b64.encode("Alias '" + b64.decode(newAlias) + 
                  "' is already in use")
          });
        } 
        else { // new alias set
          console.log(`Client ${clientId} has been associated with alias '${b64.decode(newAlias)}'`);

          // If the alias was set, store the alias in the reverse hash
          var oldAlias = clientAlias;
          clientAlias = newAlias;

          // Set the client alias
          context.redis.hset("client-id-hash", clientId, clientAlias)

          // Broadcast the alias change
          .then(() => {
            var oldAliasRaw = b64.decode(oldAlias);
            var newAliasRaw = b64.decode(newAlias);

            return context.redis.publish(BROADCAST_CHANNEL, JSON.stringify({
              from: 0,
              alias: b64.encode("server"),
              body: b64.encode(`Client ${clientId} has changed alias from '${oldAliasRaw}' to '${newAliasRaw}'`)
            }));
          })

          // Emit the alias update to the client
          .then(() => {
            socket.emit('alias', { alias : clientAlias });
            return context;
          })

          // Fetch the old alias
          .then(() => {
            return context.redis.hget("client-id-hash", clientId)
          })

          // Delete the old alias
          .then((oldAlias) => {
            if (oldAlias) {
              context.redis.hdel("client-alias-hash", oldAlias)
              .then((result) => {
                console.log(`Client ${clientId} has been disassociated from alias '${b64.decode(oldAlias)}`);
              });
            }
          })
          
          // Handle any errors updating the client's alias
          .catch((error) => {
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
        body : b64.encode(`Welcome client ${clientId}`)
    });
  })

  // Handle any errors with the client socket
  .catch((error) => {
    console.log("Error:", error, "\nStack:\n", error.stack);
  });

  ws.on('message', (message) => {
    // TODO: Figure out what this is for. Perhaps direct messages?
  });
});

// Add static middleware for the www directory
app.use('/', express.static('www'));

// Start the server
app.listen(bindPort, () => {
  console.log(`Listening on port ${bindPort}...`);
});

