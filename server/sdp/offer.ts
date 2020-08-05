import sdpTransform from 'sdp-transform';
import { WebRtcTransport, Consumer } from 'mediasoup/lib/types';
import { OfferMediaSection } from './mediaSection';
import Logger from '../lib/logger';

const logger = new Logger('offer.ts');

export default class OfferSdp {
  transport: WebRtcTransport;
  planB = false;
  _firstMid?: string;
  _sdpObject: any;
  private _midToIndex: Map<string, number> = new Map();
  private _mediaSections: OfferMediaSection[] = [];

  constructor(transport: WebRtcTransport, planB: boolean) {
    this.transport = transport;
    this.planB = planB;

    this._sdpObject = {};
  }

  createOffer(consumers: Consumer[], version?: number) {

    const {
      iceParameters,
      dtlsParameters,
    } = this.transport;

    this._sdpObject =
    {
      version : 0,
      origin  :
      {
        address        : '0.0.0.0',
        ipVer          : 4,
        netType        : 'IN',
        sessionId      : 10000,
        sessionVersion : version || 0,
        username       : 'mediasoup-client'
      },
      name   : '-',
      timing : { start: 0, stop: 0 },
      media  : []
    };

    // If ICE parameters are given, add ICE-Lite indicator.
    if (iceParameters && iceParameters.iceLite)
    {
      this._sdpObject.icelite = 'ice-lite';
    }

    // If DTLS parameters are given, assume WebRTC and BUNDLE.
    if (dtlsParameters)
    {
      this._sdpObject.msidSemantic = { semantic: 'WMS', token: '*' };

      // NOTE: We take the latest fingerprint.
      const numFingerprints = dtlsParameters.fingerprints.length;

      this._sdpObject.fingerprint =
      {
        type : dtlsParameters.fingerprints[numFingerprints - 1].algorithm,
        hash : dtlsParameters.fingerprints[numFingerprints - 1].value
      };

      this._sdpObject.groups = [ { type: 'BUNDLE', mids: '' } ];
    }

    // If there are plain RTP parameters, override SDP origin.
    // if (plainRtpParameters)
    // {
    //   this._sdpObject.origin.address = plainRtpParameters.ip;
    //   this._sdpObject.origin.ipVer = plainRtpParameters.ipVersion;
    // }

    consumers.forEach(consumer => this.send(consumer));

    return this.getSdp();
  }

  send(consumer: Consumer) {
    logger.debug('consumer, kind: %s, id: %s', consumer.kind, consumer.id);
    const { kind, rtpParameters } = consumer;
    const streamId = rtpParameters.rtcp!.cname!;
    const trackId = consumer.id;

    let mid = consumer.rtpParameters.mid || String(this._midToIndex.size);
    // planB 
    if (this.planB) {
      mid = consumer.kind;
    }

    let mediaSection: OfferMediaSection;
    const idx = this._midToIndex.get(mid);
    if (idx !== undefined) {
      mediaSection = this._mediaSections[idx];

      mediaSection.planBReceive({ offerRtpParameters: rtpParameters, streamId, trackId });
      this._replaceMediaSection(mediaSection);
    } else {
      // Unified-Plan or different media kind.
      mediaSection = new OfferMediaSection({
        mid,
        kind,
        offerRtpParameters: rtpParameters,
        streamId,
        trackId,
        iceParameters: this.transport.iceParameters,
        iceCandidates: this.transport.iceCandidates,
        dtlsParameters: this.transport.dtlsParameters,
      });
      this.addMediaSection(mediaSection);
    }
  }

  addMediaSection(mediaSetion: OfferMediaSection) {
    if (!this._firstMid) {
      this._firstMid = mediaSetion.mid;
    }
    this._mediaSections.push(mediaSetion);
    this._midToIndex.set(mediaSetion.mid, this._mediaSections.length - 1);
    this._sdpObject.media.push(mediaSetion.getObject());
		this._regenerateBundleMids();

  }

  _replaceMediaSection(newMediaSection: OfferMediaSection, reuseMid?: string): void
  {
    // Store it in the map.
    if (reuseMid)
    {
      const idx = this._midToIndex.get(reuseMid);
      if (!idx) {
        throw new Error(`_replaceMediaSection: mid "${reuseMid}" not found`);
      }
      const oldMediaSection = this._mediaSections[idx];

      // Replace the index in the vector with the new media section.
      this._mediaSections[idx] = newMediaSection;

      // Update the map.
      this._midToIndex.delete(oldMediaSection.mid);
      this._midToIndex.set(newMediaSection.mid, idx);

      // Update the SDP object.
      this._sdpObject.media[idx] = newMediaSection.getObject();

      // Regenerate BUNDLE mids.
      this._regenerateBundleMids();
    }
    else
    {
      const idx = this._midToIndex.get(newMediaSection.mid) as number;

      // Replace the index in the vector with the new media section.
      this._mediaSections[idx] = newMediaSection;

      // Update the SDP object.
      this._sdpObject.media[idx] = newMediaSection.getObject();
    }
  }

  _regenerateBundleMids(): void
  {
    if (!this.transport.dtlsParameters)
      return;

    this._sdpObject.groups[0].mids = this._mediaSections
      .filter((mediaSection: OfferMediaSection) => !mediaSection.closed)
      .map((mediaSection: OfferMediaSection) => mediaSection.mid)
      .join(' ');
  }
  
  getSdp(): string
  {
   // Increase SDP version.
    this._sdpObject.origin.sessionVersion++;

    return sdpTransform.write(this._sdpObject);
  }
}
