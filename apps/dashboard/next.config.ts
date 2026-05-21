import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
}

export default withSentryConfig(config, {
  silent: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
})
