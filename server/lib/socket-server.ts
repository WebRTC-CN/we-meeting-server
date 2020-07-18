import SocketIO from 'socket.io';
import cookie from 'cookie';
import Peer from './peer';
import http from 'http';
import https from 'https';
import Logger from './logger';

const logger = new Logger('socket-server');

let io: SocketIO.Server;
export function setupWebsocket(httpServers: (https.Server | http.Server)[]) {
  io = SocketIO({
    path: '/ws'
  });
  httpServers.forEach((server) => io.attach(server));

  logger.debug('socket.io server start');

  io.on('connect', (socket) => {
    logger.debug('connection request')
    let cookies = cookie.parse(socket.request.headers.cookie || '');
    let token = cookies.token;
    if (!token) {
      token = socket.handshake.query.token;
    }
    if (!token) {
      throw new Error('Authentication fail, token not found');
    }

    if (!checkToken(token)) {
      throw new Error('Authentication fail, token invalidate');
    }
    new Peer(token, socket);
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
function checkToken(token: string) {
  
  return Boolean(token);
}