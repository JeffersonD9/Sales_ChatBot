import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const repoRoot = fs.existsSync(path.resolve(process.cwd(), 'packages'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..', '..')
const platformData = require(path.join(repoRoot, 'packages/platform-data/index.js')) as {
  media: {
    createLocalVpsStorageAdapter: () => {
      saveImage(args: {
        tenantSlug: string
        scope?: string
        buffer: Buffer
        config: Record<string, unknown>
      }): Promise<Record<string, unknown>>
      saveAudio(args: {
        tenantSlug: string
        scope?: string
        buffer: Buffer
        allowedFormats: string[]
      }): Promise<Record<string, unknown>>
      list(args: { tenantSlug: string; type?: string }): Promise<Record<string, unknown>[]>
      delete(relativePath: string): Promise<{ deleted: boolean }>
      resolveFinalUrl(value: string): string
    }
    detectMime(buffer: Buffer): { kind: 'image' | 'audio'; ext: string; mime: string } | null
    normalizeMediaStorageConfig(botConfig: Record<string, unknown>): {
      enabled: boolean
      importProductsEnabled: boolean
      imageMaxWidth: number
      outputFormat: 'jpeg' | 'webp' | 'original'
      quality: number
      generateThumbnail: boolean
      thumbnailWidth: number
      preserveExif: boolean
      maxImageUploadMb: number
      maxAudioUploadMb: number
      allowedImageFormats: string[]
      allowedAudioFormats: string[]
    }
  }
}

export const mediaStorage = platformData.media
