import assert from 'node:assert/strict'
import test from 'node:test'
import {
  insecureVideoEnvironmentAllowed,
  isSecureServiceUrl,
  serviceUrl
} from '../service-url.mjs'

test('production service URLs require HTTPS by default', () => {
  assert.throws(
    () => serviceUrl('VIDEO_BASE_URL', 'http://87.242.117.37:5051', { production: true }),
    /must use HTTPS/
  )
  assert.equal(
    serviceUrl('VIDEO_BASE_URL', 'https://video.example.test/api/', { production: true }),
    'https://video.example.test/api'
  )
})

test('temporary public HTTP requires a narrow explicit opt-in', () => {
  assert.throws(
    () => serviceUrl('VIDEO_BASE_URL', 'http://87.242.117.37:5051', {
      production: true,
      allowInsecureHttp: true
    }),
    /must use HTTPS/
  )
  assert.equal(
    serviceUrl('VIDEO_BASE_URL', 'http://87.242.117.37:5051', {
      production: true,
      allowInsecureHttp: true,
      allowedInsecureHosts: ['87.242.117.37']
    }),
    'http://87.242.117.37:5051'
  )
  assert.throws(
    () => serviceUrl('VIDEO_BASE_URL', 'http://203.0.113.10:5051', {
      production: true,
      allowInsecureHttp: true,
      allowedInsecureHosts: ['87.242.117.37']
    }),
    /must use HTTPS/
  )
  assert.equal(isSecureServiceUrl('http://87.242.117.37:5051'), false)
  assert.equal(isSecureServiceUrl('https://video.example.test'), true)
})

test('a public LiteLLM endpoint requires the same exact plaintext host allowlist', () => {
  assert.throws(
    () => serviceUrl('LITELLM_BASE_URL', 'http://192.0.2.10:4000', {
      production: true,
      allowInsecureHttp: true,
      allowedInsecureHosts: ['192.0.2.11']
    }),
    /must use HTTPS/
  )
  assert.equal(
    serviceUrl('LITELLM_BASE_URL', 'http://192.0.2.10:4000/', {
      production: true,
      allowInsecureHttp: true,
      allowedInsecureHosts: ['192.0.2.10']
    }),
    'http://192.0.2.10:4000'
  )
})

test('Railway private HTTP remains independently supported', () => {
  assert.equal(
    serviceUrl('LLM_BASE_URL', 'http://litellm.railway.internal:4000', {
      production: true,
      allowPrivateHttp: true
    }),
    'http://litellm.railway.internal:4000'
  )
  assert.throws(
    () => serviceUrl('URL', 'https://user:pass@example.test/path', { production: true }),
    /forbidden URL components/
  )
})

test('public plaintext video is limited to staging or local development/test', () => {
  assert.equal(insecureVideoEnvironmentAllowed({
    production: true, analyticsEnvironment: 'production'
  }), false)
  assert.equal(insecureVideoEnvironmentAllowed({
    production: true, analyticsEnvironment: 'staging'
  }), true)
  assert.equal(insecureVideoEnvironmentAllowed({
    production: false, analyticsEnvironment: 'development'
  }), true)
  assert.equal(insecureVideoEnvironmentAllowed({
    production: false, analyticsEnvironment: 'production'
  }), false)
})
