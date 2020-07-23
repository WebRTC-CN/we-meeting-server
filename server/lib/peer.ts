import { WebRtcTransport, RtpParameters, RtpCapabilities } from "mediasoup/lib/types";
import { EventEmitter } from 'events';
import { Producer, Consumer, DtlsParameters, MediaKind } from 'mediasoup/lib/types';
import Logger from './logger';
import Room, { ROOM_EVENT } from "./room";
import config from '../config/index'

const logger = new Logger('peer');

enum COMMAND {
  JOIN = 'join',

  CREATE_TRANSPORT = 'createTransport',
  CONNECT_TRANSPORT = 'connectTransport',

  CREATE_PRODUCER = 'createProducer',
  CLOSE_PRODUCER = 'closeProducer',

  CREATE_CONSUMER = 'createConsumer',
  RESUME_COMSUMER = 'resumeConsumer',
  PAUSE_CONSUMER = 'paurseConsumer',
};

export default class Peer extends EventEmitter {
  
  id: string;
  username?: string;
  room?: Room;
  socket: SocketIO.Socket;
  transports: Map<string, WebRtcTransport> = new Map();
  producers: Map<string, Producer> = new Map();
  consumers: Map<string, Consumer> = new Map();

  constructor(id: string, socket: SocketIO.Socket, username?: string) {
    super();
    this.setMaxListeners(Infinity);
    this.id = id;
    this.socket = socket;
    this.username = username;

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

  async join(roomId: string) {
    if (this.room) {
      throw new Error(`already in room: ${this.room.id}`);
    }
    const room = await Room.getOrCreateRoom(roomId);
    this.room = room;

    room.addPeer(this);
    // use socket.io room
    this.socket.join(roomId);
    return room;
  }

  async _createTransport() {
    if (!this.room) {
      throw new Error('join a room first');
    }
    const transport = await this.room.mediaRouter.createWebRtcTransport(
      config.mediasoup.webRtcTransportOptions
    );
    transport.on('routerclose', () => transport.close());
    this.transports.set(transport.id, transport);
    return transport;
  }

  _connect(transportId: string, dtlsParameters: DtlsParameters) {
    const transport = this.transports.get(transportId);
    if (!transport) {
      throw new Error(`transport "${transportId}" not exist`);
    }
    return transport.connect({ dtlsParameters });
  }

  async createProducer(transportId: string, kind: string, rtpParameters: RtpParameters) {
    const transport = this.transports.get(transportId);
    if (!transport) {
      throw new Error(`transport "${transportId}" not exist`);
    }
    const producer = await transport.produce({
      kind: kind as MediaKind,
      rtpParameters
    });
    this.producers.set(producer.id, producer);

    // producer events
    producer.on('score', (score) => logger.debug(`producer: ${producer.id}, score: ${score}`));
    // RTCPeerConnection closed
    producer.on('transportclose', () => {
      producer.close();
      this.producers.delete(producer.id);
    });

    this.broadcast(ROOM_EVENT.NEW_PRODUCER, {
      peerId: this.id,
      user: {
        id: this.id,
        name: this.username
      },
      id: producer.id,
    });

    return producer;
  }

  async createConsumer(
    transportId: string, 
    producerId: string, 
    rtpCapabilities: RtpCapabilities,
    paused = true,
  ) {
    const transport = this.transports.get(transportId);
    if (!transport) {
      throw new Error(`transport "${transportId}" not exist`);
    }
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused
    });
    this.consumers.set(consumer.id, consumer);
    
    // consumer Events
    consumer.on('score', (score) => logger.debug(`consumer: ${consumer.id}, score: ${score}`));

    consumer.on('transportclose', () => this.consumers.delete(consumer.id))
      .on('producerclose', () => this.consumers.delete(consumer.id));
      
    return consumer;
  }

  async handleCmd(cmd: string, data: any, accept:(...args: any[]) => void, reject: (...args: any[]) => void) {
    logger.debug('cmd: %s, data: %o', cmd, data);
    try {
      switch(cmd) {
        case COMMAND.JOIN: {
          checkParameterExist(data, ['roomId']);
          const room = await this.join(data.roomId);
          accept({
            id: room.id,
            rtpCapabilities: room.rtbCapabilities,
            peers: room.getAllPeerProducers()
          });
          break;
        }
        case COMMAND.CREATE_TRANSPORT: {
          let transport = await this._createTransport();
          accept({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
            sctpParameters: transport.sctpParameters,
          });
          break;
        }
        // mediasoup 通过dtlsParameter通信
        case COMMAND.CONNECT_TRANSPORT: {
          checkParameterExist(data, ['transportId', 'dtlsParameters']);
          const { transportId, dtlsParameters } = data;
          await this._connect(transportId, dtlsParameters);
          accept(true);
          break;
        }
        case COMMAND.CREATE_PRODUCER: {
          checkParameterExist(data, ['transportId', 'kind', 'rtpParameters']);
          const { transportId, kind, rtpParameters } = data;
          let producer = await this.createProducer(transportId, kind, rtpParameters);
          accept({
            id: producer.id
          });
          break;
        }
        case COMMAND.CREATE_CONSUMER: {
          checkParameterExist(data, ['transportId', 'producerId', 'rtpCapabilities']);
          const { transportId, producerId, rtpCapabilities } = data;
          const consumer = await this.createConsumer(
            transportId,
            producerId,
            rtpCapabilities,
            data.paused
          );
          accept({
            id: consumer.id,
            producerId,
            rtpParameters: consumer.rtpParameters,
            type: consumer.type,
            kind: consumer.kind,
            producerPaused: consumer.producerPaused,
          });
          break;
        }
        case COMMAND.PAUSE_CONSUMER: {
          checkParameterExist(data, ['id']);
          const consumer = this.consumers.get(data.id);
          if (!consumer) {
            return reject(`consumer "${data.id}" is not exist`);
          }
          await consumer.pause();
          accept(true);
          break;
        }
        case COMMAND.RESUME_COMSUMER: {
          checkParameterExist(data, ['id']);
          const consumer = this.consumers.get(data.id);
          if (!consumer) {
            return reject(`consumer "${data.id}" is not exist`);
          }
          await consumer.resume();
          accept(true);
          break;
        }
      }
    } catch(e) {
      logger.error(e);
      reject(e.toString());
    }
  } 

  handleEvent(name: string, data: any) {

  }

  broadcast(event: string, data: any) {
    if (!this.room) {
      return;
    }
    logger.debug('broadcast: %s, data: %o', event, data);
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
    this.room?.removePeer(this);
  }
  
}

function checkParameterExist(data: any, keys: string[]) {
  for(let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i];
    if (data[key] === undefined) {
      throw new Error(`parameter ${key} is required`);
    }
  }
  return true;
}