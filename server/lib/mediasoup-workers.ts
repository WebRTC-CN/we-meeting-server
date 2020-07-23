import * as mediasoup from 'mediasoup';
import Logger from './logger';
import config from '../config/index';

const logger = new Logger('mediasoup-workers');
const workers: mediasoup.types.Worker[] = [];
let index = 0;

export async function runMediasoupServer() {
  const {
    logLevel,
    logTags,
    rtcMaxPort,
    rtcMinPort
  } = config.mediasoup.workerSettings;
  for (let i = 0; i < config.mediasoup.numWorkers; i += 1) {
    const worker = await mediasoup.createWorker({
      logLevel,
      logTags,
      rtcMinPort,
      rtcMaxPort
    });
    workers.push(worker);
    worker.on('died', () => {
      logger.error('mediasoup Worker died, [pid:%d], drop it', worker.pid);
      const index = workers.indexOf(worker);
      if (index > -1) {
        workers.splice(index, 1);
      }
    });
  }
  
  logger.debug('mediasoup start with %s workers, ip: %s', workers.length,
  config.mediasoup.webRtcTransportOptions.listenIps.map(s => s.ip).join(','));
}

function getMediasoupWorker() {
  const worker = workers[index];
  index += 1;
  if (index === workers.length) {
    index = 0;
  }
  return worker;
}

export async function createMediasoupRouter() {
  const worker = getMediasoupWorker();
  return worker.createRouter({
    mediaCodecs: config.mediasoup.routerOptions.mediaCodecs
  });
}

export async function getResourceUsage() {
  let promises: Promise<mediasoup.types.WorkerResourceUsage>[];
  promises = workers.map(worker => worker.getResourceUsage());
  
  return Promise.all(promises);
}

export default {
  runMediasoupServer,
  getMediasoupWorker,
  getResourceUsage,
  createMediasoupRouter,
};
