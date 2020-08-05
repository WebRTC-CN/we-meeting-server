import sdpTransform from 'sdp-transform';
import { WebRtcTransport, RtpCapabilities, MediaKind, RtpParameters, RtpCodecParameters, RtpCodecCapability } from "mediasoup/lib/types";
import { AnswerMediaSection } from './mediaSection';

import { extractRtpCapabilities, 
  getExtendedRtpCapabilities, 
  getSendingRtpParameters, 
  getPlanBRtpEncodings, 
  getTrackId, 
  extractDtlsParameters,
  getRtpEncodings,
  isRtxCodec,
  matchCodecs
} from './utils';

export default class AnswerSdp {

  transport: WebRtcTransport;
  planB = false;
  _firstMid?: string;
  _sdpObject: any;
  routerCapabilities: RtpCapabilities;
  private _midToIndex: Map<string, number> = new Map();
  private _mediaSections: AnswerMediaSection[] = [];

  constructor({ transport, planB, routerCapabilities } : {
    transport: WebRtcTransport,
    planB: boolean,
    routerCapabilities: RtpCapabilities
  }) {
    this.transport = transport;
    this.planB = planB;
    this.routerCapabilities = routerCapabilities;
  }

  initSdpObject() {
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
        sessionVersion : 0,
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

    // If there are plain RPT parameters, override SDP origin.
    // if (plainRtpParameters)
    // {
    //   this._sdpObject.origin.address = plainRtpParameters.ip;
    //   this._sdpObject.origin.ipVer = plainRtpParameters.ipVersion;
    // }
  }

  answerTo(offerSdp: string) {
    this.initSdpObject();

    let offerSdpObject = sdpTransform.parse(offerSdp);
    const offerCapabilities = extractRtpCapabilities({
      sdpObject: offerSdpObject
    });
    const extendedCapabilites = getExtendedRtpCapabilities(
      offerCapabilities,
      this.routerCapabilities
    );
    //console.log(extendedCapabilites);
    
    const producerParams: {
      kind: MediaKind,
      rtpParameters: RtpParameters,
      trackId: string
    }[]= [];
    for (const media of offerSdpObject.media) {
      const offerRtpParameters = getSendingRtpParameters(media.type as MediaKind, extendedCapabilites);
      const answerRtpParameters = getSendingRtpParameters(media.type as MediaKind, extendedCapabilites);
      answerRtpParameters.codecs = this.reduceCodecs(answerRtpParameters.codecs);
      if (!this.planB) {
        offerRtpParameters.encodings = getRtpEncodings(media);
        this.addMediaObject({
          offerMediaObject: media,
          offerRtpParameters,
          answerRtpParameters,
          extmapAllowMixed: false, // true in mediasoup-client in chrome >= 74 & firefox >= 60
        });

        producerParams.push({
          kind: media.type as MediaKind,
          rtpParameters: offerRtpParameters,
          trackId: getTrackId(media)
        });
      } else {
        const mapTrackId = new Map();
        for (const line of media.ssrcs || []) {
          if (line.attribute !== 'msid') continue;

          const trackId = line.value?.split(' ')[1];
          if (!trackId || mapTrackId.get(trackId)) continue;
          // 防止有ssrc-group时，重复添加
          mapTrackId.set(trackId, 1);
          console.log(line, trackId);
          offerRtpParameters.encodings = getPlanBRtpEncodings({
            offerMediaObject: media,
            trackId
          });
          console.log(offerRtpParameters.encodings);
          this.addMediaObject({
            offerMediaObject: media,
            offerRtpParameters: {...offerRtpParameters},
            answerRtpParameters,
            extmapAllowMixed: false,
          });
          producerParams.push({
            kind: media.type as MediaKind,
            rtpParameters: {...offerRtpParameters},
            trackId: trackId as string
          });
        }
      }
    }
    //console.log(producerParams);
    return {
      producerParams,
      dtlsParameters: extractDtlsParameters(offerSdpObject),
      sdp: this.getSdp()
    };
  }

  addMediaObject({
    offerMediaObject,
    offerRtpParameters,
    answerRtpParameters,
    extmapAllowMixed = false
    //codecOptions, //https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  }: {
    offerMediaObject: any,
    offerRtpParameters: RtpParameters,
    answerRtpParameters: RtpParameters,
    extmapAllowMixed?: boolean
  }) {
    const mediaSection = new AnswerMediaSection({
      iceParameters: this.transport.iceParameters,
      iceCandidates: this.transport.iceCandidates,
      dtlsParameters: this.transport.dtlsParameters,
      planB: this.planB,
      offerMediaObject,
      offerRtpParameters,
      answerRtpParameters,
      extmapAllowMixed
    });
    mediaSection.setDtlsRole('client');
    
    if (!this._midToIndex.has(mediaSection.mid)) {
      // Unified-Plan or Plan-B with different media kind 
      this.addMediaSection(mediaSection);   
    } else {
      this._replaceMediaSection(mediaSection);
    }
    return mediaSection;
  }

  addMediaSection(mediaSetion: AnswerMediaSection) {
    if (!this._firstMid) {
      this._firstMid = mediaSetion.mid;
    }
    this._mediaSections.push(mediaSetion);
    this._midToIndex.set(mediaSetion.mid, this._mediaSections.length - 1);
    this._sdpObject.media.push(mediaSetion.getObject());
		this._regenerateBundleMids();

  }

  _replaceMediaSection(newMediaSection: AnswerMediaSection, reuseMid?: string): void
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
      .filter((mediaSection: AnswerMediaSection) => !mediaSection.closed)
      .map((mediaSection: AnswerMediaSection) => mediaSection.mid)
      .join(' ');
  }
  
  getSdp(): string
  {
  // Increase SDP version.
    this._sdpObject.origin.sessionVersion++;

    return sdpTransform.write(this._sdpObject);
  }

  reduceCodecs(
    codecs: RtpCodecParameters[],
    capCodec?: RtpCodecCapability
  ): RtpCodecParameters[]
  {
    const filteredCodecs: RtpCodecParameters[] = [];
  
    // If no capability codec is given, take the first one (and RTX).
    if (!capCodec)
    {
      filteredCodecs.push(codecs[0]);
  
      if (isRtxCodec(codecs[1]))
        filteredCodecs.push(codecs[1]);
    }
    // Otherwise look for a compatible set of codecs.
    else
    {
      for (let idx = 0; idx < codecs.length; ++idx)
      {
        if (matchCodecs(codecs[idx], capCodec))
        {
          filteredCodecs.push(codecs[idx]);
  
          if (isRtxCodec(codecs[idx + 1]))
            filteredCodecs.push(codecs[idx + 1]);
  
          break;
        }
      }
  
      if (filteredCodecs.length === 0)
        throw new TypeError('no matching codec found');
    }
    return filteredCodecs;
  }

}
