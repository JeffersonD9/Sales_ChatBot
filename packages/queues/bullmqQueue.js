import IORedis from 'ioredis';
import bullmq from 'bullmq';
import loggerModule from '@whatsapp-saas/logger';
import infraModule from '@whatsapp-saas/config/infra.js';

const { Queue, Worker, QueueEvents } = bullmq;
const { logger } = loggerModule;
const { getRedisConnectionOptions, getRedisUrl } = infraModule;

const queues = new Map();
const workers = new Map();
const events = new Map();
const connections = new Set();

function createConnection() {
  if (process.env.NODE_ENV === 'test') {
    throw new Error('BullMQ no debe inicializarse en NODE_ENV=test');
  }

  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    throw new Error('REDIS_URL requerido para BullMQ');
  }

  const connection = new IORedis(redisUrl, {
    ...getRedisConnectionOptions(),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  connection.on('error', (err) => {
    logger.error({ err: err.message }, '[BullMQ] Error Redis');
  });

  connections.add(connection);
  return connection;
}

export function getQueue(queueName) {
  if (!queues.has(queueName)) {
    queues.set(queueName, new Queue(queueName, {
      connection: createConnection(),
      defaultJobOptions: {
        attempts: parseInt(process.env.QUEUE_JOB_ATTEMPTS || '3', 10),
        backoff: {
          type: 'exponential',
          delay: parseInt(process.env.QUEUE_BACKOFF_MS || '1000', 10),
        },
        removeOnComplete: {
          age: parseInt(process.env.QUEUE_REMOVE_COMPLETE_SECONDS || '86400', 10),
          count: parseInt(process.env.QUEUE_REMOVE_COMPLETE_COUNT || '1000', 10),
        },
        removeOnFail: {
          age: parseInt(process.env.QUEUE_REMOVE_FAIL_SECONDS || '604800', 10),
          count: parseInt(process.env.QUEUE_REMOVE_FAIL_COUNT || '5000', 10),
        },
      },
    }));
  }

  return queues.get(queueName);
}

export function getQueueEvents(queueName) {
  if (!events.has(queueName)) {
    events.set(queueName, new QueueEvents(queueName, { connection: createConnection() }));
  }

  return events.get(queueName);
}

export async function enqueue(queueName, payload, options = {}) {
  const queue = getQueue(queueName);
  const job = await queue.add(options.name || queueName, payload, {
    jobId: options.jobId,
    priority: options.priority,
    delay: options.delay,
    attempts: options.attempts,
    backoff: options.backoff,
    removeOnComplete: options.removeOnComplete,
    removeOnFail: options.removeOnFail,
  });

  logger.info({ queue: queueName, jobId: job.id }, '[BullMQ] Job encolado');
  return job;
}

export function registerProcessor(queueName, processor, options = {}) {
  if (workers.has(queueName)) return workers.get(queueName);

  const concurrency = parseInt(options.concurrency || process.env.QUEUE_CONCURRENCY || '5', 10);
  const worker = new Worker(queueName, processor, {
    connection: createConnection(),
    concurrency,
  });

  worker.on('completed', (job) => {
    logger.info({
      metric: 'queue.job.completed',
      queue: queueName,
      jobId: job.id,
      attemptsMade: job.attemptsMade,
      queueWaitMs: job.processedOn && job.timestamp ? job.processedOn - job.timestamp : null,
      durationMs: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
    }, '[BullMQ] Job completado');
  });

  worker.on('failed', (job, err) => {
    logger.error({
      metric: 'queue.job.failed',
      queue: queueName,
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      queueWaitMs: job?.processedOn && job?.timestamp ? job.processedOn - job.timestamp : null,
      durationMs: job?.finishedOn && job?.processedOn ? job.finishedOn - job.processedOn : null,
      err: err.message,
    }, '[BullMQ] Job fallo');
  });

  workers.set(queueName, worker);
  logger.info({ queue: queueName, concurrency }, '[BullMQ] Processor registrado');
  return worker;
}

export async function closeBullMQ() {
  const closers = [
    ...Array.from(workers.values()).map((worker) => worker.close()),
    ...Array.from(events.values()).map((queueEvents) => queueEvents.close()),
    ...Array.from(queues.values()).map((queue) => queue.close()),
  ];

  await Promise.allSettled(closers);

  for (const connection of connections) {
    await connection.quit().catch(() => connection.disconnect());
  }

  workers.clear();
  events.clear();
  queues.clear();
  connections.clear();
}
