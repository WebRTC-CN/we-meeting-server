import { types } from 'mediasoup';
import os from 'os';
import fs from 'fs';

const IP = process.env.IP || getIP();

export default {
  http: {
    listenPort: 8001,
  },
  https: {
    listenIp: '0.0.0.0',
    listenPort: 8000,
    // NOTE: Set your own valid certificate files.
    tls: {
      cert: fs.readFileSync('./cert/server.cert'),
      key: fs.readFileSync('./cert/server.key'),
    },
  },
  // mediasoup settings.
  mediasoup: {
    // Number of mediasoup workers to launch.
    numWorkers: 2, // Object.keys(os.cpus()).length,
    // mediasoup WorkerSettings.
    // See https://mediasoup.org/documentation/v3/mediasoup/api/#WorkerSettings
    workerSettings: {
      logLevel: 'warn' as types.WorkerLogLevel,
      logTags:
      [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp',
        'rtx',
        'bwe',
        'score',
        'simulcast',
        'svc',
        'sctp',
      ] as types.WorkerLogTag[],
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
    },
    // mediasoup Router options.
    // See https://mediasoup.org/documentation/v3/mediasoup/api/#RouterOptions
    routerOptions: {
      mediaCodecs: [
        {
          kind      : 'audio' as types.MediaKind,
          mimeType  : 'audio/opus',
          clockRate : 48000,
          channels  : 2
        },
       /*
        {
          kind       : 'video' as types.MediaKind,
          mimeType   : 'video/VP8',
          clockRate  : 90000,
          parameters :
          {
            'x-google-start-bitrate' : 1000
          }
        },
        {
          kind       : 'video' as types.MediaKind,
          mimeType   : 'video/VP9',
          clockRate  : 90000,
          parameters :
          {
            'profile-id'             : 2,
            'x-google-start-bitrate' : 1000
          }
        },*/
        // {
        //   kind       : 'video' as types.MediaKind,
        //   mimeType   : 'video/h264',
        //   clockRate  : 90000,
        //   parameters :
        //   {
        //     'packetization-mode'      : 1,
        //     'profile-level-id'        : '4d0032',
        //     'level-asymmetry-allowed' : 1,
        //     'x-google-start-bitrate'  : 1000
        //   }
        // },
        {
          kind       : 'video' as types.MediaKind,
          mimeType   : 'video/h264',
          clockRate  : 90000,
          parameters :
          {
            'packetization-mode'      : 1,
            'profile-level-id'        : '42e01f',
            'level-asymmetry-allowed' : 1,
            'x-google-start-bitrate'  : 1000
          }
        }
      ]
    },
    // mediasoup WebRtcTransport options for WebRTC endpoints (mediasoup-client,
    // libmediasoupclient).
    // See https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
    webRtcTransportOptions: {
      listenIps :
      [
        {
          ip          : IP,
          announcedIp : process.env.MEDIASOUP_ANNOUNCED_IP
        }
      ],
      initialAvailableOutgoingBitrate : 1000000,
      minimumAvailableOutgoingBitrate : 600000,
      maxSctpMessageSize              : 262144,
      // Additional options that are not part of WebRtcTransportOptions.
      maxIncomingBitrate              : 1500000
    },
    // mediasoup PlainTransport options for legacy RTP endpoints (FFmpeg,
    // GStreamer).
    // See https://mediasoup.org/documentation/v3/mediasoup/api/#PlainTransportOptions
    plainTransportOptions: {
      listenIp: {
        ip          : IP,
        announcedIp : process.env.MEDIASOUP_ANNOUNCED_IP
      },
      maxSctpMessageSize : 262144
    }
  }
}

function getIP() {
  const ifaces = os.networkInterfaces();
  for (const dev in ifaces) {
    if (!dev.startsWith('lo')) {
      const eno = ifaces[dev]!;
      for (const network of eno) {
        if (network.family === 'IPv4') {
          return network.address;
        }
      }
    }
  }
  return '';
}
