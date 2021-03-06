"use strict";
const PORT = 3005;

const TaleMarketWatcher = require('./tale-market-watcher.js').TaleMarketWatcher;

const http = require("http");
const Promise = require("bluebird");
const WS = require("ws");
const TaleAccount = require("./account.js").Account;
const url = require('url');
const WebSocket = require('ws');


const tale = new TaleAccount("trade-bot@webtricks.pro","he11ass55trade");
const marketWatcher = new TaleMarketWatcher(tale);


const wss = new WebSocket.Server({
  perMessageDeflate: false,
  port: PORT
});

wss.broadcast = function broadcast(data) {
  console.log("Broadcast", data);
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
};

function processWsConnections(ws) {
  ws.on('message', function incoming(message) {
    switch (message) {
      case 'get-stats':
        ws.send(JSON.stringify(
          {
            "status": "ok",
            "message":"market-stat",
            "data": marketWatcher.lotCardMap
          }
        ));
        break;
      case "ping":
        ws.send(JSON.stringify(
          {
            "status": "ok",
            "message":"pong"
          }
        ));
        break;
      default:
        ws.send(JSON.stringify(
          {
            "status": "error",
            "message":"Unknown Request",
            "data": message
          }
        ));
    }
  });

  ws.send(JSON.stringify({"status": "ok", "message":"hello"}));
}


function processLoginToTale(err, account) {
  if (err) {
    console.log("Erro on Login", err);
    return;
  }
  console.log("Success login to Tale");
  marketWatcher.startWatch()
    .then(function(){
      marketWatcher.on("LOT_SOLD", function(lot){
        console.log("Lot sold", lot);
      });
      marketWatcher.on("LOT_EXPIRED", function(lot){
        console.log("Lot expired", lot);
      });
      marketWatcher.on("LOT_PLACE", function(lot){
        console.log("Lot places", lot);
        wss.broadcast(JSON.stringify({
          "status": "ok",
          "message": "new-lot",
          "lot": lot
        }))
      });
      marketWatcher.on("STATS_UPDATED", function(stats){
        console.log("Stats Updated");
      });

      wss.on('connection', processWsConnections);
    })
    .catch(function(err){
      console.log("Error", err);
    });
}

tale.login(processLoginToTale);
