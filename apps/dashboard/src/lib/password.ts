import { hash, verify } from '@node-rs/argon2'

// Parámetros OWASP 2024 para Argon2id:
// 64 MB de memoria, 3 iteraciones, 1 hilo
const OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS)
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  return verify(stored, plain, OPTIONS)
}
