import SocketIO from 'socket.io';
import cookie from 'cookie';
import Peer from './peer';
import http from 'http';
import https from 'https';
import Logger from './logger';

import { verify } from './userService';

const logger = new Logger('socket-server');

let io: SocketIO.Server;
export function setupWebsocket(httpServers: (https.Server | http.Server)[]) {
  io = SocketIO({
    path: '/ws'
  });
  httpServers.forEach((server) => io.attach(server));

  logger.debug('socket.io server start');

  io.on('connect', async (socket) => {
    logger.debug('connection request')
    let cookies = cookie.parse(socket.request.headers.cookie || '');
    let token = cookies.token;
    if (!token) {
      token = socket.handshake.query.token;
    }
    if (!token) {
      logger.error('Authentication fail, token not found');
      socket.disconnect(true);
      return ;
    }

    const userInfo = await checkToken(token);
    if (!userInfo) {
      logger.error('Authentication fail, token invalidate');
      socket.disconnect(true);
      return ;
    }
    new Peer(userInfo.id, socket, userInfo.name);
  });

  return io;
}

export function broadcastTo(roomId: string, event: string, data: any) {
  return io.to(roomId).emit('event', {
    name: event,
    data
  });
}

/**
 * todo 验证用户信息
 * @param token
 */
async function checkToken(token: string) {
  try {
    const userBean = await verify(token);
    return userBean;
  } catch(e) {
    logger.error(e);
    return '';
  }
}