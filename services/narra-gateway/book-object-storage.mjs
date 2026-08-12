import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
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

async function responseBodyBuffer(body, maxBytes) {
  if (!body) throw new Error('object storage returned an empty body')
  let buffer
  if (typeof body.transformToByteArray === 'function') {
    buffer = Buffer.from(await body.transformToByteArray())
  } else if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    buffer = Buffer.from(body)
  } else if (body[Symbol.asyncIterator]) {
    const chunks = []
    let total = 0
    for await (const chunk of body) {
      const bytes = Buffer.from(chunk)
      total += bytes.byteLength
      if (total > maxBytes) invalid('object exceeds the allowed read size')
      chunks.push(bytes)
    }
    buffer = Buffer.concat(chunks, total)
  } else {
    throw new Error('object storage returned an unsupported body')
  }
  if (buffer.byteLength > maxBytes) invalid('object exceeds the allowed read size')
  return buffer
}

export function createBookObjectStorage({
  client,
  signingClient = client,
  bucket,
  uploadExpiresSeconds = 900,
  downloadExpiresSeconds = 300,
  getSignedUrlImpl = getSignedUrl
}) {
  if (!client || typeof client.send !== 'function') throw new TypeError('S3 client is required')
  if (!signingClient || typeof signingClient.send !== 'function') {
    throw new TypeError('S3 signing client is required')
  }
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
      const url = await getSignedUrlImpl(signingClient, command, {
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
        url: await getSignedUrlImpl(signingClient, command, { expiresIn: downloadExpiresSeconds }),
        expiresAt: new Date(Date.now() + downloadExpiresSeconds * 1_000).toISOString()
      }
    },

    async getBytes({ objectKey: rawObjectKey, maxBytes = 64 * 1024 * 1024 }) {
      const key = objectKey(rawObjectKey)
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 512 * 1024 * 1024) {
        throw new RangeError('maxBytes must be between 1 byte and 512 MiB')
      }
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (Number(result.ContentLength || 0) > maxBytes) invalid('object exceeds the allowed read size')
      return {
        bytes: await responseBodyBuffer(result.Body, maxBytes),
        mimeType: result.ContentType || 'application/octet-stream',
        metadata: result.Metadata || {}
      }
    },

    async getBytesRange({
      objectKey: rawObjectKey,
      startByte,
      endByteExclusive,
      maxBytes = 64 * 1024 * 1024
    }) {
      const key = objectKey(rawObjectKey)
      if (
        !Number.isSafeInteger(startByte) || startByte < 0 ||
        !Number.isSafeInteger(endByteExclusive) || endByteExclusive <= startByte
      ) {
        invalid('byte range is invalid')
      }
      const expectedBytes = endByteExclusive - startByte
      if (
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 512 * 1024 * 1024 ||
        expectedBytes > maxBytes
      ) {
        invalid('object range exceeds the allowed read size')
      }
      const result = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: `bytes=${startByte}-${endByteExclusive - 1}`
      }))
      const bytes = await responseBodyBuffer(result.Body, maxBytes)
      if (bytes.byteLength !== expectedBytes) {
        throw Object.assign(new Error('object storage returned an unexpected byte range'), {
          code: 'STORAGE_RANGE_INTEGRITY'
        })
      }
      return {
        bytes,
        mimeType: result.ContentType || 'application/octet-stream',
        metadata: result.Metadata || {}
      }
    },

    async putBytes({ objectKey: rawObjectKey, bytes: rawBytes, mimeType }) {
      const key = objectKey(rawObjectKey)
      const bytes = Buffer.from(rawBytes)
      if (!bytes.byteLength) invalid('bytes: generated object is empty')
      if (typeof mimeType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)) {
        invalid('mimeType: invalid media type')
      }
      const contentHash = createHash('sha256').update(bytes).digest('hex')
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: mimeType,
        ChecksumSHA256: checksumBase64(contentHash),
        Metadata: { content_sha256: contentHash }
      }))
      return {
        objectKey: key,
        contentHash,
        mimeType,
        byteSize: bytes.byteLength
      }
    },

    async deleteObjects(rawObjectKeys) {
      if (!Array.isArray(rawObjectKeys)) throw new TypeError('object keys must be an array')
      const keys = [...new Set(rawObjectKeys.map((key) => objectKey(key)))]
      let deleted = 0
      for (let index = 0; index < keys.length; index += 1_000) {
        const batch = keys.slice(index, index + 1_000)
        if (!batch.length) continue
        const result = await client.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true }
        }))
        if (result.Errors?.length) {
          throw Object.assign(new Error('object storage failed to delete generated materials'), {
            code: 'STORAGE_DELETE'
          })
        }
        deleted += batch.length
      }
      return { deleted }
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
  const publicEndpoint = serviceUrl(
    'BOOK_STORAGE_PUBLIC_ENDPOINT',
    env.BOOK_STORAGE_PUBLIC_ENDPOINT,
    { production: env.NODE_ENV === 'production' }
  )
  const accessKeyId = String(env.BOOK_STORAGE_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = String(env.BOOK_STORAGE_SECRET_ACCESS_KEY || '').trim()
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('BOOK_STORAGE_ACCESS_KEY_ID and BOOK_STORAGE_SECRET_ACCESS_KEY are required together')
  }
  const clientOptions = {
    region: String(env.BOOK_STORAGE_REGION || 'us-east-1'),
    forcePathStyle: parseEnvBool(env, 'BOOK_STORAGE_FORCE_PATH_STYLE', false),
    credentials: accessKeyId ? { accessKeyId, secretAccessKey } : undefined
  }
  const client = new S3Client({ ...clientOptions, endpoint: endpoint || undefined })
  const signingClient = publicEndpoint
    ? new S3Client({ ...clientOptions, endpoint: publicEndpoint })
    : client
  return createBookObjectStorage({
    client,
    signingClient,
    bucket,
    uploadExpiresSeconds: parseEnvInt(env, 'BOOK_UPLOAD_URL_TTL_SECONDS', 900, 3_600),
    downloadExpiresSeconds: parseEnvInt(env, 'BOOK_DOWNLOAD_URL_TTL_SECONDS', 300, 3_600)
  })
}
