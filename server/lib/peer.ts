import { WebRtcTransport } from "mediasoup/lib/types";
import { EventEmitter } from 'events';
import { Producer, Consumer, DtlsParameters } from 'mediasoup/lib/types';
import Logger from './logger';
import Room from "./room";


const logger = new Logger('peer');

export default class Peer extends EventEmitter {
  
  id: string;
  room?: Room;
  socket: SocketIO.Socket;
  transports: Map<string, WebRtcTransport> = new Map();
  producres: Map<string, Producer> = new Map();
  consumers: Map<string, Consumer> = new Map();

  constructor(id: string, socket: SocketIO.Socket) {
    super();
    this.setMaxListeners(Infinity);
    this.id = id;
    this.socket = socket;

    this.initSocket();
  }

  initSocket() {
    // cmd，必须有响应值，方便客户端处理
    this.socket.on('cmd', ({ name, data}, callback) => {
      this.handleCmd(name, data, (res) => {
        callback('success', res);
      }, (res) => {
        callback('error', res);
      })
    });

    this.socket.on('event', ({ name, data}) => {
      this.handleEvent(name, data);
    });

    this.socket.on('disconnect', () => {
      this.destroy();
    });
  }

  handleCmd(cmd: string, data: any, accept:(...args: any[]) => void, reject: (...args: any[]) => void) {

    
  } 

  handleEvent(name: string, data: any) {

  }

  broadcast(event: string, data: any) {
    if (!this.room) {
      return;
    }
    logger.debug('broadcast:', event);
    this.socket.to(this.room.id).emit('event', {
      name: event,
      data
    });
  }

  notify(event: string, data: any) {
    this.socket.emit('event', {
      name: event,
      data
    });
  }

  destroy() {
    for (const transport of this.transports.values()) {
      transport.close();
    }
    this.socket.disconnect();
  }
  
}