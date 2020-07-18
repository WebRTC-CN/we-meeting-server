import express from 'express';
import https from 'https';
import http from 'http';
import nPath from 'path';

import config from './config/index';
import { runMediasoupServer } from './lib/mediasoup-workers';
import { setupWebsocket } from './lib/socket-server';

function runWebServer() {
  const app = express();
  const {
    tls,
    listenPort,
    listenIp,
  } = config.https;

  const server = https.createServer(tls, app);
  const httpServer = http.createServer(app);

  setupWebsocket([server, httpServer]);
  runMediasoupServer();

  server.listen(listenPort, listenIp, () => {
    console.log('https server start, port: %s', listenPort);
  });
  httpServer.listen(config.http.listenPort, () => {
    console.log('http server start, port: %s', config.http.listenPort);
  });
  
  //web root
  const dir = nPath.join(process.cwd(), './app');
  app.use(express.static(dir));
  console.log('web root start at: %s', dir);
}

runWebServer();