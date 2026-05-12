export function getQueueMode() {
  return (process.env.QUEUE_MODE || process.env.WHATSAPP_INBOUND_QUEUE_MODE || 'direct').toLowerCase();
}

export function isBullMQMode() {
  return getQueueMode() === 'bullmq' || getQueueMode() === 'redis';
}

export function isDirectQueueMode() {
  return getQueueMode() === 'memory';
}

export function getAIQueueMode() {
  return (process.env.AI_QUEUE_MODE || 'direct').toLowerCase();
}

export function isAIBullMQMode() {
  const mode = getAIQueueMode();
  return mode === 'bullmq' || mode === 'redis';
}
