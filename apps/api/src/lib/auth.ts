import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

export const SESSION_COOKIE = 'crm_sid';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h, sliding

export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (hashStr: string, pw: string) => verify(hashStr, pw).catch(() => false);

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
