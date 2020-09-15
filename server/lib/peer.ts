import { WebRtcTransport, RtpParameters, RtpCapabilities } from "mediasoup/lib/types";
import { EventEmitter } from 'events';
import { Producer, Consumer, DtlsParameters, MediaKind } from 'mediasoup/lib/types';
import Logger from './logger';
import Room, { ROOM_EVENT } from "./room";
import config from '../config/index'
import OfferSdp from "../sdp/offer";
import AnswerSdp from "../sdp/answer";
import { extractDtlsParameters } from "../sdp/utils";

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

  GET_OFFER_SDP = 'getOfferSdp',
  GET_ANSWER_SDP = 'getAnswerSdp',
};

export default class Peer extends EventEmitter {
  
  id: string;
  username?: string;
  room?: Room;
  socket: SocketIO.Socket;
  transports: Map<string, WebRtcTransport> = new Map();
  producers: Map<string, Producer> = new Map();
  consumers: Map<string, Consumer> = new Map();
  _trackToProducer: Map<String, Producer> = new Map();

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
      logger.debug('socket close, peer will destroy, %s', this.id);
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
      logger.debug('transportclosed, %s', producer.id);
      this.producers.delete(producer.id);
    });
    producer.observer.on('close', (...args) => {
      logger.debug('producer close', ...args);
    })

    this.broadcast(ROOM_EVENT.NEW_PRODUCER, {
      peerId: this.id,
      user: {
        id: this.id,
        name: this.username
      },
      kind,
      id: producer.id,
    });

    return producer;
  }

  async createConsumer(
    transportId: string, 
    producerId: string, 
    rtpCapabilities: RtpCapabilities,
    paused = true,
    appData = {},
  ) {
    const transport = this.transports.get(transportId);
    if (!transport) {
      throw new Error(`transport "${transportId}" not exist`);
    }
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused,
      appData
    });
    this.consumers.set(consumer.id, consumer);
    
    // consumer Events
    consumer.on('score', (score) => logger.debug(`consumer: ${consumer.id}, score: ${score}`));
    const onClosed = () => {
      consumer.close();
      this.consumers.delete(consumer.id);
      this.notify('consumerClosed', {
        id: consumer.id,
        appData: consumer.appData
      });
    };
    consumer
      .on('transportclose', () => {
        logger.debug('transportclose');
        onClosed();
      })
      .on('producerclose', () => {
        logger.debug('producerclose');
        onClosed();
      });

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
            peerId: this.id,
            rtpCapabilities: room.rtpCapabilities,
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
          const { transportId, producerId, rtpCapabilities, appData } = data;
          const consumer = await this.createConsumer(
            transportId,
            producerId,
            rtpCapabilities,
            data.paused,
            appData,
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
        case COMMAND.GET_OFFER_SDP: {
          checkParameterExist(data, ['version', 'transportId', 'peerId']);
          this.createOfferSdp(data)
            .then(accept, (e) => {
              logger.error(e);
              reject(e);
            });
          break;
        }
        case COMMAND.GET_ANSWER_SDP: {
          checkParameterExist(data, ['transportId', 'sdp']);
          this.createAnswerSdp(data).then(accept, (e) => {
            logger.error(e);
            reject(e);
          });
          break;
        }
        case 'connectTransportWithOffer': {
          const { transportId, sdp, role } = data;
          if (!transportId) { return reject('transportId required') }

          const dtlsParameters = extractDtlsParameters(sdp) as DtlsParameters;
          dtlsParameters.role = role || 'client';
          if (this.transports.get(transportId)) {
            await this.transports.get(transportId)!.connect({ dtlsParameters });
            accept(true);
          } else {
            reject(`transportId "${transportId}" not match any transport`);
          }
          break;
        }
      }
    } catch(e) {
      logger.error(e);
      reject(e.toString());
    }
  }

  async createOfferSdp(data: any) {
    const { isPlanB, version, transportId, peerId } = data;
    const transport = this.transports.get(transportId);
    if (transport === undefined) {
      logger.debug(this.transports);
      throw new Error(`transport "${transportId}" not found`);
    }
    let producers = this.room!.getProducersOf(peerId);
    if (producers == null || producers.length === 0) {
      throw new Error('no stream found');
    }
    const hash: {[key: string]: Consumer} = {};
    for(let consumer of this.consumers.values()) {
      hash[consumer.producerId] = consumer;
    }
    const promises: Promise<Consumer>[] = [];
    for (const producer of producers) {
      if (hash[producer.id]) {
        promises.push(Promise.resolve(hash[producer.id]));
      } else {
        promises.push(this.createConsumer(
          transportId,
          producer.id,
          this.room!.rtpCapabilities,
          data.paused ?? true,
          {
            peerId
          }
        ));
      }
    }
    const consumerList = await Promise.all(promises);
    const offerSdp = new OfferSdp(transport, isPlanB);
    const offer = offerSdp.createOffer(consumerList, version);
    return {
      sdp: offer,
      consumers: consumerList.map(consumer => {
        return {
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind
        };
      })
    };
  }

  async createAnswerSdp(data: any) {
    const { sdp: offerSdp, isPlanB, transportId } = data;
    const transport = this.transports.get(transportId);
    if (transport === undefined) {
      throw new Error(`transport "${transportId} not found"`);
    }

    const answerSdp = new AnswerSdp({
      planB: isPlanB,
      transport,
      routerCapabilities: this.room!.rtpCapabilities
    });
    const { producerParams, sdp, dtlsParameters } = answerSdp.answerTo(offerSdp);
    //logger.debug(producerParams);
    // connect if transport isn't connected
    if (transport.dtlsState !== 'connected') {
      // role 'client' will be error
      dtlsParameters.role = 'server';
      await transport.connect({
        dtlsParameters: dtlsParameters as DtlsParameters
      });
      // must be connected
      logger.debug('inputTransport.connect(), %s', transport.dtlsState);
    }

    // diff tracks
    const tracks = new Map();
    const newProducers: Producer[] = [];
    const closedProducers: Producer[] = [];
    logger.debug(producerParams);
    for (const param of producerParams) {
      const trackId = param.trackId || param.kind;
      let producer = this._trackToProducer.get(trackId);
      if (producer === undefined) {
        logger.debug('inputTransport.produce(), %o', param.rtpParameters.encodings);
        producer = await this.createProducer(transportId, param.kind, param.rtpParameters);
        this._trackToProducer.set(trackId, producer);
        logger.debug('createdProducer, %s, trackId: %s', producer.id, trackId);
        newProducers.push(producer);
      }
      tracks.set(trackId, producer);
    }
    for (const [trackId, producer] of this._trackToProducer.entries()) {
      if (tracks.get(trackId) == null) {
        producer.close();
        this._trackToProducer.delete(trackId);
        this.producers.delete(producer.id);
        closedProducers.push(producer);
      }
    }
    if (newProducers.length) {
      Promise.resolve().then(() => {
        newProducers.forEach(producer => {
          this.notify(ROOM_EVENT.NEW_PRODUCER, {
            peerId: this.id,
            user: {
              id: this.id,
              name: this.username
            },
            kind: producer.kind,
            id: producer.id,
          });
        });
      });
    }
    //logger.debug('answer: %s', sdp);
    return { 
      sdp, 
      producers: [...this._trackToProducer.values()]
        .map(producer => ({ kind: producer.kind, id: producer.id })) 
    };
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
