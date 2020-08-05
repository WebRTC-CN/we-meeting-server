import sdpTransform from 'sdp-transform';
import * as h264 from 'h264-profile-level-id';

import { 
  RtpCapabilities, 
  RtpHeaderExtension, 
  RtpCodecCapability, 
  RtcpFeedback,
  RtpCodecParameters,
  MediaKind,
  RtpParameters,
  RtpHeaderExtensionParameters,
	RtpEncodingParameters,
} from 'mediasoup/lib/types';

/**
 * Generate extended RTP capabilities for sending and receiving.
 * from mediasoup-client ortc.ts
 */
export function getExtendedRtpCapabilities(
	localCaps: RtpCapabilities,
	remoteCaps: RtpCapabilities
): any
{
	const extendedRtpCapabilities: any =
	{
		codecs           : [],
		headerExtensions : []
	};

	// Match media codecs and keep the order preferred by remoteCaps.
	for (const remoteCodec of remoteCaps.codecs || [])
	{
		if (isRtxCodec(remoteCodec))
			continue;

		const matchingLocalCodec = (localCaps.codecs || [])
			.find((localCodec: RtpCodecCapability) => (
				matchCodecs(localCodec, remoteCodec, { strict: true, modify: true }))
			);

		if (!matchingLocalCodec)
			continue;

		const extendedCodec: any =
		{
			mimeType             : matchingLocalCodec.mimeType,
			kind                 : matchingLocalCodec.kind,
			clockRate            : matchingLocalCodec.clockRate,
			channels             : matchingLocalCodec.channels,
			localPayloadType     : matchingLocalCodec.preferredPayloadType,
			localRtxPayloadType  : undefined,
			remotePayloadType    : remoteCodec.preferredPayloadType,
			remoteRtxPayloadType : undefined,
			localParameters      : matchingLocalCodec.parameters,
			remoteParameters     : remoteCodec.parameters,
			rtcpFeedback         : reduceRtcpFeedback(matchingLocalCodec, remoteCodec)
		};

		extendedRtpCapabilities.codecs.push(extendedCodec);
	}

	// Match RTX codecs.
	for (const extendedCodec of extendedRtpCapabilities.codecs)
	{
		const matchingLocalRtxCodec = localCaps?.codecs
			?.find((localCodec: RtpCodecCapability) => (
				isRtxCodec(localCodec) &&
				localCodec.parameters.apt === extendedCodec.localPayloadType
			));

		const matchingRemoteRtxCodec = remoteCaps?.codecs
			?.find((remoteCodec: RtpCodecCapability) => (
				isRtxCodec(remoteCodec) &&
				remoteCodec.parameters.apt === extendedCodec.remotePayloadType
			));

		if (matchingLocalRtxCodec && matchingRemoteRtxCodec)
		{
			extendedCodec.localRtxPayloadType = matchingLocalRtxCodec.preferredPayloadType;
			extendedCodec.remoteRtxPayloadType = matchingRemoteRtxCodec.preferredPayloadType;
		}
	}

	// Match header extensions.
	for (const remoteExt of remoteCaps.headerExtensions!)
	{
		const matchingLocalExt = localCaps.headerExtensions
			?.find((localExt: RtpHeaderExtension) => (
				matchHeaderExtensions(localExt, remoteExt)
			));

		if (!matchingLocalExt)
			continue;

		const extendedExt =
		{
			kind      : remoteExt.kind,
			uri       : remoteExt.uri,
			sendId    : matchingLocalExt.preferredId,
			recvId    : remoteExt.preferredId,
			encrypt   : matchingLocalExt.preferredEncrypt,
			direction : 'sendrecv'
		};

		switch (remoteExt.direction)
		{
			case 'sendrecv':
				extendedExt.direction = 'sendrecv';
				break;
			case 'recvonly':
				extendedExt.direction = 'sendonly';
				break;
			case 'sendonly':
				extendedExt.direction = 'recvonly';
				break;
			case 'inactive':
				extendedExt.direction = 'inactive';
				break;
		}

		extendedRtpCapabilities.headerExtensions.push(extendedExt);
	}

	return extendedRtpCapabilities;
}

/**
 * Generate RTP parameters of the given kind for sending media.
 * NOTE: mid, encodings and rtcp fields are left empty.
 */
export function getSendingRtpParameters(
	kind: MediaKind,
	extendedRtpCapabilities: any
): RtpParameters
{
	const rtpParameters: RtpParameters =
	{
		mid              : undefined,
		codecs           : [],
		headerExtensions : [],
		encodings        : [],
		rtcp             : {}
	};

	for (const extendedCodec of extendedRtpCapabilities.codecs)
	{
		if (extendedCodec.kind !== kind)
			continue;

		const codec: RtpCodecParameters =
		{
			mimeType     : extendedCodec.mimeType,
			payloadType  : extendedCodec.localPayloadType,
			clockRate    : extendedCodec.clockRate,
			channels     : extendedCodec.channels,
			parameters   : extendedCodec.localParameters,
			rtcpFeedback : extendedCodec.rtcpFeedback
		};

		rtpParameters.codecs.push(codec);

		// Add RTX codec.
		if (extendedCodec.localRtxPayloadType)
		{
			const rtxCodec: RtpCodecParameters =
			{
				mimeType    : `${extendedCodec.kind}/rtx`,
				payloadType : extendedCodec.localRtxPayloadType,
				clockRate   : extendedCodec.clockRate,
				parameters  :
				{
					apt : extendedCodec.localPayloadType
				},
				rtcpFeedback : []
			};

			rtpParameters.codecs.push(rtxCodec);
		}
	}

	for (const extendedExtension of extendedRtpCapabilities.headerExtensions)
	{
		// Ignore RTP extensions of a different kind and those not valid for sending.
		if (
			(extendedExtension.kind && extendedExtension.kind !== kind) ||
			(
				extendedExtension.direction !== 'sendrecv' &&
				extendedExtension.direction !== 'sendonly'
			)
		)
		{
			continue;
		}

		const ext: RtpHeaderExtensionParameters =
		{
			uri        : extendedExtension.uri,
			id         : extendedExtension.sendId,
			encrypt    : extendedExtension.encrypt,
			parameters : {}
		};

		rtpParameters.headerExtensions?.push(ext);
	}

	return rtpParameters;
}

/**
 * Generate RTP parameters of the given kind suitable for the remote SDP answer.
 */
export function getSendingRemoteRtpParameters(
	kind: MediaKind,
	extendedRtpCapabilities: any
): RtpParameters
{
	const rtpParameters: RtpParameters =
	{
		mid              : undefined,
		codecs           : [],
		headerExtensions : [],
		encodings        : [],
		rtcp             : {}
	};

	for (const extendedCodec of extendedRtpCapabilities.codecs)
	{
		if (extendedCodec.kind !== kind)
			continue;

		const codec: RtpCodecParameters =
		{
			mimeType     : extendedCodec.mimeType,
			payloadType  : extendedCodec.localPayloadType,
			clockRate    : extendedCodec.clockRate,
			channels     : extendedCodec.channels,
			parameters   : extendedCodec.remoteParameters,
			rtcpFeedback : extendedCodec.rtcpFeedback
		};

		rtpParameters.codecs.push(codec);

		// Add RTX codec.
		if (extendedCodec.localRtxPayloadType)
		{
			const rtxCodec: RtpCodecParameters =
			{
				mimeType    : `${extendedCodec.kind}/rtx`,
				payloadType : extendedCodec.localRtxPayloadType,
				clockRate   : extendedCodec.clockRate,
				parameters  :
				{
					apt : extendedCodec.localPayloadType
				},
				rtcpFeedback : []
			};

			rtpParameters.codecs.push(rtxCodec);
		}
	}

	for (const extendedExtension of extendedRtpCapabilities.headerExtensions)
	{
		// Ignore RTP extensions of a different kind and those not valid for sending.
		if (
			(extendedExtension.kind && extendedExtension.kind !== kind) ||
			(
				extendedExtension.direction !== 'sendrecv' &&
				extendedExtension.direction !== 'sendonly'
			)
		)
		{
			continue;
		}

		const ext: RtpHeaderExtensionParameters =
		{
			uri        : extendedExtension.uri,
			id         : extendedExtension.sendId,
			encrypt    : extendedExtension.encrypt,
			parameters : {}

		};

		rtpParameters.headerExtensions?.push(ext);
	}

	// Reduce codecs' RTCP feedback. Use Transport-CC if available, REMB otherwise.
	if (
		rtpParameters.headerExtensions?.some((ext) => (
			ext.uri === 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01'
		))
	)
	{
		for (const codec of rtpParameters.codecs)
		{
			codec.rtcpFeedback = (codec.rtcpFeedback || [])
				.filter((fb: RtcpFeedback) => fb.type !== 'goog-remb');
		}
	}
	else if (
		rtpParameters.headerExtensions?.some((ext) => (
			ext.uri === 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
		))
	)
	{
		for (const codec of rtpParameters.codecs)
		{
			codec.rtcpFeedback = (codec.rtcpFeedback || [])
				.filter((fb) => fb.type !== 'transport-cc');
		}
	}
	else
	{
		for (const codec of rtpParameters.codecs)
		{
			codec.rtcpFeedback = (codec.rtcpFeedback || [])
				.filter((fb: RtcpFeedback) => (
					fb.type !== 'transport-cc' &&
					fb.type !== 'goog-remb'
				));
		}
	}

	return rtpParameters;
}

export function extractRtpCapabilities(
	{ sdpObject }:
	{ sdpObject: any }
) : RtpCapabilities
{
	// Map of RtpCodecParameters indexed by payload type.
	const codecsMap: Map<number, RtpCodecCapability> = new Map();
	// Array of RtpHeaderExtensions.
	const headerExtensions: RtpHeaderExtension[] = [];
	// Whether a m=audio/video section has been already found.
	let gotAudio = false;
	let gotVideo = false;

	for (const m of sdpObject.media)
	{
		const kind = m.type;

		switch (kind)
		{
			case 'audio':
			{
				if (gotAudio)
					continue;

				gotAudio = true;

				break;
			}
			case 'video':
			{
				if (gotVideo)
					continue;

				gotVideo = true;

				break;
			}
			default:
			{
				continue;
			}
		}

		// Get codecs.
		for (const rtp of m.rtp)
		{
			const codec: RtpCodecCapability =
			{
				kind                 : kind,
				mimeType             : `${kind}/${rtp.codec}`,
				preferredPayloadType : rtp.payload,
				clockRate            : rtp.rate,
				channels             : rtp.encoding,
				parameters           : {},
				rtcpFeedback         : []
			};

			codecsMap.set(codec.preferredPayloadType!, codec);
		}

		// Get codec parameters.
		for (const fmtp of m.fmtp || [])
		{
			const parameters = sdpTransform.parseParams(fmtp.config);
			const codec = codecsMap.get(fmtp.payload);

			if (!codec)
				continue;

			// Specials case to convert parameter value to string.
			if (parameters && parameters['profile-level-id'])
				parameters['profile-level-id'] = String(parameters['profile-level-id']);

			codec.parameters = parameters;
		}

		// Get RTCP feedback for each codec.
		for (const fb of m.rtcpFb || [])
		{
			const codec = codecsMap.get(fb.payload);

			if (!codec)
				continue;

			const feedback: RtcpFeedback =
			{
				type      : fb.type,
				parameter : fb.subtype
			};

			if (!feedback.parameter)
				delete feedback.parameter;

			codec.rtcpFeedback?.push(feedback);
		}

		// Get RTP header extensions.
		for (const ext of m.ext || [])
		{
			// Ignore encrypted extensions (not yet supported in mediasoup).
			if (ext['encrypt-uri'])
				continue;

			const headerExtension: RtpHeaderExtension =
			{
				kind        : kind,
				uri         : ext.uri,
				preferredId : ext.value
			};

			headerExtensions.push(headerExtension);
		}
	}

	const rtpCapabilities: RtpCapabilities =
	{
		codecs           : Array.from(codecsMap.values()),
		headerExtensions : headerExtensions
	};

	return rtpCapabilities;
}


export function extractDtlsParameters(sdpObject: string | {[key: string]: any}) {
	if (typeof sdpObject === 'string') {
		sdpObject = sdpTransform.parse(sdpObject);
	}
  const mediaObject = (sdpObject.media || [])
    .find((m: any) => (
      m.iceUfrag && m.port !== 0
    ));

  if (!mediaObject)
    throw new Error('no active media section found');

  const fingerprint = mediaObject.fingerprint || sdpObject.fingerprint;
  let role: string = 'auto';
  
  /**
   * setup: 'active' => the endpoint will initiate an outgoing conncetion
   *       'passive' => the endpoint will accept an incoming connection
   */
  switch (mediaObject.setup){
    case 'active':
      role = 'client';
      break;
    case 'passive':
      role = 'server';
      break;
    case 'actpass':
      role = 'auto';
      break;
  }
  return {
    role,
    fingerprints :[
      {
        algorithm : fingerprint!.type,
        value     : fingerprint!.hash
      }
    ]
  }
}

export function getRtpEncodings(offerMediaObject:{ [key: string]: any }): RtpEncodingParameters[] {
	const ssrcs = new Set();

	for (const line of offerMediaObject.ssrcs || []) {
		const ssrc = line.id;

		ssrcs.add(ssrc);
	}

	if (ssrcs.size === 0)
		throw new Error('no a=ssrc lines found');

	const ssrcToRtxSsrc = new Map();

	// First assume RTX is used.
	for (const line of offerMediaObject.ssrcGroups || [])
	{
		if (line.semantics !== 'FID')
			continue;

		let [ ssrc, rtxSsrc ] = line.ssrcs.split(/\s+/);

		ssrc = Number(ssrc);
		rtxSsrc = Number(rtxSsrc);

		if (ssrcs.has(ssrc))
		{
			// Remove both the SSRC and RTX SSRC from the set so later we know that they
			// are already handled.
			ssrcs.delete(ssrc);
			ssrcs.delete(rtxSsrc);

			// Add to the map.
			ssrcToRtxSsrc.set(ssrc, rtxSsrc);
		}
	}

	// If the set of SSRCs is not empty it means that RTX is not being used, so take
	// media SSRCs from there.
	for (const ssrc of ssrcs)
	{
		// Add to the map.
		ssrcToRtxSsrc.set(ssrc, null);
	}

	const encodings: RtpEncodingParameters[] = [];

	for (const [ ssrc, rtxSsrc ] of ssrcToRtxSsrc)
	{
		const encoding: RtpEncodingParameters = { ssrc };

		if (rtxSsrc)
			encoding.rtx = { ssrc: rtxSsrc };

		encodings.push(encoding);
	}

	return encodings;
}

export function getCname(offerMediaObject: {[key: string]: any }): string {
	const ssrcCnameLine = (offerMediaObject.ssrcs || [])
		.find((line: { attribute: string }) => line.attribute === 'cname');

	if (!ssrcCnameLine)
		return '';

	return ssrcCnameLine.value;
}

export function getTrackId(offerMediaObject: any): string {
	const ssrcMsidLine = (offerMediaObject.ssrcs || [])
		.find((line: {attribute: string}) => line.attribute === 'msid');
	if (!ssrcMsidLine) {
		return '';
	}
	return ssrcMsidLine.value.split(' ')[1];
}

export function getPlanBRtpEncodings(
	{
		offerMediaObject,
		trackId
	}:
	{
		offerMediaObject: any;
		trackId: string;
	}
): RtpEncodingParameters[]
{
	const ssrcs = new Set();

	for (const line of offerMediaObject.ssrcs || [])
	{
		if (line.attribute !== 'msid')
			continue;

		const id = line.value.split(' ')[1];

		if (id === trackId)
		{
			const ssrc = line.id;
			ssrcs.add(ssrc);
		}
	}

	if (ssrcs.size === 0)
		throw new Error(`a=ssrc line with msid information not found [track.id:${trackId}]`);

	const ssrcToRtxSsrc = new Map();

	// First assume RTX is used.
	for (const line of offerMediaObject.ssrcGroups || [])
	{
		if (line.semantics !== 'FID')
			continue;

		let [ ssrc, rtxSsrc ] = line.ssrcs.split(/\s+/);

		ssrc = Number(ssrc);
		rtxSsrc = Number(rtxSsrc);

		if (ssrcs.has(ssrc))
		{
			// Remove both the SSRC and RTX SSRC from the set so later we know that they
			// are already handled.
			ssrcs.delete(ssrc);
			ssrcs.delete(rtxSsrc);

			// Add to the map.
			ssrcToRtxSsrc.set(ssrc, rtxSsrc);
		}
	}

	// If the set of SSRCs is not empty it means that RTX is not being used, so take
	// media SSRCs from there.
	for (const ssrc of ssrcs)
	{
		// Add to the map.
		ssrcToRtxSsrc.set(ssrc, null);
	}

	const encodings: RtpEncodingParameters[] = [];

	for (const [ ssrc, rtxSsrc ] of ssrcToRtxSsrc)
	{
		const encoding: any = { ssrc };

		if (rtxSsrc)
			encoding.rtx = { ssrc: rtxSsrc };

		encodings.push(encoding);
	}

	return encodings;
}

/**
 * Clones the given object/array.
 *
 * @param {Object|Array} obj
 *
 * @returns {Object|Array}
 */
export function clone(obj: any): any
{
	if (typeof obj !== 'object')
		return {};

	return JSON.parse(JSON.stringify(obj));
}

/**
 * Generates a random positive integer.
 */
export function generateRandomNumber(): number
{
	return Math.round(Math.random() * 10000000);
}

export function isRtxCodec(codec?: RtpCodecCapability | RtpCodecParameters): boolean
{
	if (!codec)
		return false;

	return /.+\/rtx$/i.test(codec.mimeType);
}

export function matchCodecs(
	aCodec: RtpCodecCapability | RtpCodecParameters,
	bCodec: RtpCodecCapability | RtpCodecParameters,
	{ strict = false, modify = false } = {}
): boolean
{
	const aMimeType = aCodec.mimeType.toLowerCase();
	const bMimeType = bCodec.mimeType.toLowerCase();

	if (aMimeType !== bMimeType)
		return false;

	if (aCodec.clockRate !== bCodec.clockRate)
		return false;

	if (aCodec.channels !== bCodec.channels)
		return false;

	// Per codec special checks.
	switch (aMimeType)
	{
		case 'video/h264':
		{
			const aPacketizationMode = aCodec.parameters['packetization-mode'] || 0;
			const bPacketizationMode = bCodec.parameters['packetization-mode'] || 0;

			if (aPacketizationMode !== bPacketizationMode)
				return false;

			// If strict matching check profile-level-id.
			if (strict)
			{
				if (!h264.isSameProfile(aCodec.parameters, bCodec.parameters))
					return false;

				let selectedProfileLevelId;

				try
				{
					selectedProfileLevelId =
						h264.generateProfileLevelIdForAnswer(aCodec.parameters, bCodec.parameters);
				}
				catch (error)
				{
					return false;
				}

				if (modify)
				{
					if (selectedProfileLevelId)
						aCodec.parameters['profile-level-id'] = selectedProfileLevelId;
					else
						delete aCodec.parameters['profile-level-id'];
				}
			}

			break;
		}

		case 'video/vp9':
		{
			// If strict matching check profile-id.
			if (strict)
			{
				const aProfileId = aCodec.parameters['profile-id'] || 0;
				const bProfileId = bCodec.parameters['profile-id'] || 0;

				if (aProfileId !== bProfileId)
					return false;
			}

			break;
		}
	}

	return true;
}

function matchHeaderExtensions(
	aExt: RtpHeaderExtension,
	bExt: RtpHeaderExtension
): boolean
{
	if (aExt.kind && bExt.kind && aExt.kind !== bExt.kind)
		return false;

	if (aExt.uri !== bExt.uri)
		return false;

	return true;
}

function reduceRtcpFeedback(
	codecA: RtpCodecCapability | RtpCodecParameters,
	codecB: RtpCodecCapability | RtpCodecParameters
): RtcpFeedback[]
{
	const reducedRtcpFeedback: RtcpFeedback[] = [];

	for (const aFb of codecA.rtcpFeedback || [])
	{
		const matchingBFb = (codecB.rtcpFeedback || [])
			.find((bFb: RtcpFeedback) => (
				bFb.type === aFb.type &&
				(bFb.parameter === aFb.parameter || (!bFb.parameter && !aFb.parameter))
			));

		if (matchingBFb)
			reducedRtcpFeedback.push(matchingBFb);
	}

	return reducedRtcpFeedback;
}
