import Redis, { type RedisOptions } from 'ioredis'

declare global {
  // eslint-disable-next-line no-var
  var __redisClient: Redis | undefined
}

function createClient(): Redis | null {
  const url = process.env.REDIS_URL
  if (!url) return null

  const options: RedisOptions = {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
  }

  if (process.env.REDIS_PASSWORD) {
    options.password = process.env.REDIS_PASSWORD
  }

  if (process.env.REDIS_TLS === 'true' || url.startsWith('rediss://')) {
    options.tls = {}
  }

  const client = new Redis(url, options)

  client.on('error', () => {
    // Silencioso — Redis es opcional en el dashboard
  })

  return client
}

// Singleton seguro para hot-reload de Next.js
export function getRedisClient(): Redis | null {
  if (process.env.NODE_ENV === 'production') {
    if (!global.__redisClient) {
      global.__redisClient = createClient() ?? undefined
    }
    return global.__redisClient ?? null
  }

  if (!global.__redisClient) {
    global.__redisClient = createClient() ?? undefined
  }
  return global.__redisClient ?? null
}
