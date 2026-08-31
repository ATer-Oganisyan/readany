import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bearerToken,
  createFixedWindowByteBudget,
  createFixedWindowLimiter,
  createTokenService,
  isInstallationId,
  requireBasicAuth
} from '../security.mjs'

const INSTALLATION_ID = '123e4567-e89b-42d3-a456-426614174000'

test('installation token is signed, scoped and expires', () => {
  const service = createTokenService('a'.repeat(32), { ttlSeconds: 60 })
  const token = service.issue(INSTALLATION_ID, 7, 1_000_000)
  assert.deepEqual(
    { sub: service.verify(token, 1_030_000)?.sub, ver: service.verify(token, 1_030_000)?.ver },
    { sub: INSTALLATION_ID, ver: 7 }
  )
  assert.equal(service.verify(`${token}x`, 1_030_000), null)
  assert.equal(service.verify(token, 1_061_000), null)
})

test('fixed-window byte budget reserves a strict worst-case import allowance', () => {
  const middleware = createFixedWindowByteBudget({
    windowMs: 1_000, maxBytes: 60, reserveBytes: 30, key: () => 'installation', now: () => 100
  })
  const response = () => ({
    statusCode: 200, setHeader() {},
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this }
  })
  for (let index = 0; index < 2; index++) {
    let called = false
    middleware({}, response(), () => { called = true })
    assert.equal(called, true)
  }
  const blocked = response()
  middleware({}, blocked, () => assert.fail('budget must stop the third reservation'))
  assert.equal(blocked.statusCode, 429)
})

test('bearer and installation formats are strict', () => {
  assert.equal(bearerToken('Bearer abc.def'), 'abc.def')
  assert.equal(bearerToken('Basic abc'), '')
  assert.equal(isInstallationId(INSTALLATION_ID), true)
  assert.equal(isInstallationId('device-1'), false)
})

test('fixed-window limiter rejects requests above the configured limit', () => {
  let timestamp = 100
  const middleware = createFixedWindowLimiter({
    windowMs: 1_000,
    limit: 2,
    key: () => 'installation',
    now: () => timestamp
  })
  const response = () => ({
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this }
  })
  for (let i = 0; i < 2; i++) {
    let called = false
    middleware({}, response(), () => { called = true })
    assert.equal(called, true)
  }
  const blocked = response()
  middleware({}, blocked, () => assert.fail('must not continue'))
  assert.equal(blocked.statusCode, 429)
  timestamp = 1_101
  let called = false
  middleware({}, response(), () => { called = true })
  assert.equal(called, true)
})

test('browser basic auth compares both username and password and sends a challenge', () => {
  const middleware = requireBasicAuth({
    username: 'narra',
    password: 'operator-password-with-32-characters',
    realm: 'Narra books'
  })
  const response = () => ({
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this }
  })
  const validHeader = `Basic ${Buffer.from('narra:operator-password-with-32-characters').toString('base64')}`
  let called = false
  middleware({ headers: { authorization: validHeader } }, response(), () => { called = true })
  assert.equal(called, true)

  for (const authorization of ['', `Basic ${Buffer.from('narra:wrong').toString('base64')}`]) {
    const blocked = response()
    middleware({ headers: { authorization } }, blocked, () => assert.fail('must not continue'))
    assert.equal(blocked.statusCode, 401)
    assert.equal(blocked.headers['www-authenticate'], 'Basic realm="Narra books", charset="UTF-8"')
    assert.equal(blocked.payload.code, 'AUTH')
  }
})
