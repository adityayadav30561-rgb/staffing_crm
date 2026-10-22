import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config';
import { randomToken } from './auth';

export const ALLOWED_DOC_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'application/rtf': '.rtf',
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Checks the first bytes so a renamed executable can't pass as a resume. */
export function sniffDocType(buf: Buffer, declared: string): string | null {
  const head = buf.subarray(0, 8);
  if (head.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))
    return 'application/msword';
  if (head.subarray(0, 5).toString('latin1') === '{\\rtf') return 'application/rtf';
  if (declared === 'text/plain' && !buf.subarray(0, 512).includes(0)) return 'text/plain';
  return null;
}

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Short-lived URL the browser can open directly. */
  signedUrl(key: string, fileName: string, ttlSeconds?: number): Promise<string>;
}

export function newKey(prefix: string, ext: string) {
  const d = new Date();
  return `${prefix}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${randomToken(16)}${ext}`;
}

export function createStorage(cfg: Config): Storage {
  return cfg.storage.driver === 's3' ? s3Storage(cfg) : localStorage(cfg);
}

function localStorage(cfg: Config): Storage {
  const root = path.resolve(cfg.storage.localDir);
  const full = (key: string) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error('Bad storage key');
    return p;
  };
  return {
    async put(key, body) {
      await mkdir(path.dirname(full(key)), { recursive: true });
      await writeFile(full(key), body);
    },
    get: (key) => readFile(full(key)),
    async delete(key) {
      await unlink(full(key)).catch(() => {});
    },
    async signedUrl(key, fileName, ttl = 300) {
      return `/api/files/${signLocal(cfg.sessionSecret, key, fileName, ttl)}`;
    },
  };
}

/** Token = base64url(json{k,n,e}).hmac — verified by GET /api/files/:token. */
export function signLocal(secret: string, key: string, name: string, ttl: number) {
  const payload = Buffer.from(
    JSON.stringify({ k: key, n: name, e: Date.now() + ttl * 1000 }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyLocal(secret: string, token: string): { key: string; name: string } | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
    k: string;
    n: string;
    e: number;
  };
  if (data.e < Date.now()) return null;
  return { key: data.k, name: data.n };
}

function s3Storage(cfg: Config): Storage {
  const s = cfg.storage;
  if (!s.s3Bucket) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
  const client = new S3Client({
    region: s.s3Region,
    endpoint: s.s3Endpoint,
    credentials:
      s.s3AccessKeyId && s.s3SecretAccessKey
        ? { accessKeyId: s.s3AccessKeyId, secretAccessKey: s.s3SecretAccessKey }
        : undefined,
  });
  const Bucket = s.s3Bucket;
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    signedUrl(key, fileName, ttl = 300) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: `inline; filename="${fileName.replace(/"/g, '')}"`,
        }),
        { expiresIn: ttl },
      );
    },
  };
}
