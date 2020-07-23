import express, { Request } from 'express';
import bodyParser from 'body-parser';
import https from 'https';
import http from 'http';
import nPath from 'path';

import config from './config/index';
import { runMediasoupServer } from './lib/mediasoup-workers';
import { setupWebsocket } from './lib/socket-server';

import { verify, sign, createUser, getUserInfo } from './lib/userService';
import cookie from 'cookie';


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

  /*function allowOrigin(req: express.Request, res: express.Response, next: () => void) {
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Medthods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Credentials','true');
    
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    } else {
      next();
    }
  }*/
  
  function authMiddleware(req: any, res: express.Response, next: () => void) {
    let cookies = cookie.parse(req.headers.cookie || '');
    const token = cookies.token;
    const loginNeeded = {
      code: 602,
      message: '未登录',
      data: {}
    };
    if (!token) {
      res.json(loginNeeded);
    } else {
      verify(token)
        .then((userInfo) => {
          req.user = {
            token,
            id: userInfo.id,
            name: userInfo.name,
          };
          next();
        })
        .catch((e) => {
          res.json(loginNeeded);
        });
    }

  }
  app.use('/api/login', bodyParser.json(), (req, res) => {
    //console.log(req.headers.origin, req.method);

    if (!req.body.name || !req.body.room) {
      res.sendStatus(400);
    } else {
      let userInfo = createUser(req.body.name);
      const token = sign(userInfo);
      res.cookie('token', token, {
        httpOnly: true,
        maxAge: 3600 * 1000
      });
      res.json({
        code: 200,
        message: '',
        data: {
          token,
          ...userInfo
        }
      });
    }
  });

  app.use('/api/userinfo', authMiddleware, (req: any, res) => {
    res.json({
      code: 200,
      message: '',
      data: {
        ...req.user
      }
    });   
  });

  return app;
}

runWebServer();