import loggerModule from '@whatsapp-saas/logger';

const { logger } = loggerModule;

const processors = new Map();

export function registerProcessor(queueName, processor) {
  processors.set(queueName, processor);
  logger.info({ queue: queueName }, '[Queues] Processor directo registrado');
}

export async function enqueue(queueName, payload, options = {}) {
  const processor = processors.get(queueName);

  if (!processor) {
    throw new Error(`No hay processor directo registrado para ${queueName}`);
  }

  const job = {
    id: options.jobId || `${queueName}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    name: options.name || queueName,
    data: payload,
    opts: options,
  };

  setImmediate(async () => {
    try {
      await processor(job);
    } catch (err) {
      logger.error({ queue: queueName, jobId: job.id, err: err.message }, '[Queues] Job directo fallo');
    }
  });

  return job;
}
