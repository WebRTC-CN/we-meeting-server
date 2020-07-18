
import { createMediasoupRouter } from './mediasoup-workers';
import { Router } from 'mediasoup/lib/types';
import Peer from './peer';
import { broadcastTo } from './socket-server';

const rooms: Map<string, Room> = new Map();

export enum ROOM_EVENT  {
  ENTER = 'peerEnter',
  LEAVE = 'peerLeave',
  NEW_PRODUCER = 'newProducer'
}

export default class Room {
  id: string;
  mediaRouter: Router;
  peers: Map<string, Peer> = new Map();

  static async getOrCreateRoom(id: string) {
    let room = rooms.get(id);
    if (room === undefined) {
      const mediaRouter = await createMediasoupRouter();
      room = new Room(id, mediaRouter);
      rooms.set(id, room);
    }
    return room;
  }

  constructor(id: string, mediaRouter: Router) {
    this.id = id;
    this.mediaRouter = mediaRouter;
  }

  get rtbCapabilities() {
    return this.mediaRouter.rtpCapabilities;
  }

  addPeer(peer: Peer) {
    this.peers.set(peer.id, peer);
    this.broadcast(ROOM_EVENT.ENTER, peer.id);
  }

  removePeer(peer: Peer) {
    this.peers.delete(peer.id);
    this.broadcast(ROOM_EVENT.LEAVE, peer.id);
  }

  broadcast(event: string, data: any) {
    broadcastTo(this.id, event, data);
  }

  getAllPeerProducers() {
    const ret = [];
    for (const peer of this.peers.values()) {
      const producers = [];
      for (const producer of peer.producers.values()) {
        producers.push({
          id: producer.id,
          kind: producer.kind
        });
      }
      ret.push({
        peerId: peer.id,
        producers,
      });
    }
    return ret;
  }
}