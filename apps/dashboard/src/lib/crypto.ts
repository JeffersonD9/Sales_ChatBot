import { createCipheriv, randomBytes } from 'node:crypto'

function getKey() {
  const key = process.env.ENCRYPTION_KEY
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error('ENCRYPTION_KEY debe ser 32 bytes en hex (64 chars)')
  }
  return Buffer.from(key, 'hex')
}

export function encrypt(text: string): string {
  if (!text) return ''

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function generateVerifyToken(): string {
  return randomBytes(32).toString('hex')
}
