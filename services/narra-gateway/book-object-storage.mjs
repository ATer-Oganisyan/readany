import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { parseEnvBool, parseEnvInt } from './env.mjs'
import { serviceUrl } from './service-url.mjs'

const SHA256 = /^[0-9a-f]{64}$/
const OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9!_.*'()/-]{0,900}$/

function invalid(message) {
  throw Object.assign(new Error(message), { code: 'VALIDATION', status: 400 })
}

function objectKey(value) {
  if (typeof value !== 'string' || !OBJECT_KEY.test(value) || value.includes('//') || value.includes('..')) {
    invalid('objectKey: invalid storage key')
  }
  return value
}

function checksumBase64(hex) {
  if (typeof hex !== 'string' || !SHA256.test(hex)) invalid('contentSha256: invalid SHA-256')
  return Buffer.from(hex, 'hex').toString('base64')
}

export function createBookObjectStorage({
  client,
  bucket,
  uploadExpiresSeconds = 900,
  downloadExpiresSeconds = 300,
  getSignedUrlImpl = getSignedUrl
}) {
  if (!client || typeof client.send !== 'function') throw new TypeError('S3 client is required')
  if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket)) {
    throw new Error('BOOK_STORAGE_BUCKET is invalid')
  }

  return {
    async checkReady({ signal } = {}) {
      await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal })
      return { ready: true }
    },

    async createUpload({ objectKey: rawObjectKey, contentSha256, mimeType, byteSize }) {
      const key = objectKey(rawObjectKey)
      const checksum = checksumBase64(contentSha256)
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: mimeType,
        ContentLength: byteSize,
        ChecksumSHA256: checksum,
        Metadata: { content_sha256: contentSha256 }
      })
      const url = await getSignedUrlImpl(client, command, {
        expiresIn: uploadExpiresSeconds,
        signableHeaders: new Set(['content-type']),
        unhoistableHeaders: new Set([
          'x-amz-checksum-sha256',
          'x-amz-meta-content_sha256'
        ])
      })
      return {
        url,
        method: 'PUT',
        headers: {
          'content-type': mimeType,
          'x-amz-checksum-sha256': checksum,
          'x-amz-meta-content_sha256': contentSha256
        },
        expiresAt: new Date(Date.now() + uploadExpiresSeconds * 1_000).toISOString()
      }
    },

    async verifyUpload({ objectKey: rawObjectKey, contentSha256, mimeType, byteSize }) {
      const key = objectKey(rawObjectKey)
      const expectedChecksum = checksumBase64(contentSha256)
      const result = await client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
        ChecksumMode: 'ENABLED'
      }))
      if (
        Number(result.ContentLength) !== byteSize ||
        result.ContentType !== mimeType ||
        result.ChecksumSHA256 !== expectedChecksum
      ) {
        throw Object.assign(new Error('uploaded book failed integrity verification'), {
          code: 'UPLOAD_INTEGRITY',
          status: 409
        })
      }
      return { verified: true }
    },

    async createDownload({ objectKey: rawObjectKey, mimeType, filename }) {
      const key = objectKey(rawObjectKey)
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: mimeType,
        ResponseContentDisposition: filename
          ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
          : undefined
      })
      return {
        url: await getSignedUrlImpl(client, command, { expiresIn: downloadExpiresSeconds }),
        expiresAt: new Date(Date.now() + downloadExpiresSeconds * 1_000).toISOString()
      }
    }
  }
}

export function createBookObjectStorageFromEnv(env = process.env) {
  const bucket = String(env.BOOK_STORAGE_BUCKET || '').trim()
  if (!bucket) return null
  const endpoint = serviceUrl('BOOK_STORAGE_ENDPOINT', env.BOOK_STORAGE_ENDPOINT, {
    allowPrivateHttp: true,
    production: env.NODE_ENV === 'production'
  })
  const accessKeyId = String(env.BOOK_STORAGE_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = String(env.BOOK_STORAGE_SECRET_ACCESS_KEY || '').trim()
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('BOOK_STORAGE_ACCESS_KEY_ID and BOOK_STORAGE_SECRET_ACCESS_KEY are required together')
  }
  const client = new S3Client({
    region: String(env.BOOK_STORAGE_REGION || 'us-east-1'),
    endpoint: endpoint || undefined,
    forcePathStyle: parseEnvBool(env, 'BOOK_STORAGE_FORCE_PATH_STYLE', false),
    credentials: accessKeyId ? { accessKeyId, secretAccessKey } : undefined
  })
  return createBookObjectStorage({
    client,
    bucket,
    uploadExpiresSeconds: parseEnvInt(env, 'BOOK_UPLOAD_URL_TTL_SECONDS', 900, 3_600),
    downloadExpiresSeconds: parseEnvInt(env, 'BOOK_DOWNLOAD_URL_TTL_SECONDS', 300, 3_600)
  })
}
