import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { EVENT_NAMES as GATEWAY_CLIENT_EVENTS } from '../events.mjs'

const ROOT = new URL('../../../', import.meta.url)

function quotedNames(source) {
  return new Set([...source.matchAll(/["']([a-z][a-z0-9_]+)["']/g)].map((match) => match[1]))
}

test('Expo, gateway and stats keep one closed analytics event contract', async () => {
  const [clientSource, statsSource] = await Promise.all([
    readFile(new URL('packages/app-expo/src/lib/analytics/contract.ts', ROOT), 'utf8'),
    readFile(new URL('stats/narra/server.py', ROOT), 'utf8')
  ])
  const clientBlock = clientSource.match(/ANALYTICS_EVENTS = \[([\s\S]*?)\] as const/)?.[1]
  const statsBlock = statsSource.match(/EVENT_NAMES = \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(clientBlock, 'client event catalog is readable')
  assert.ok(statsBlock, 'stats event catalog is readable')

  const clientEvents = quotedNames(clientBlock)
  const statsEvents = quotedNames(statsBlock)
  for (const eventName of clientEvents) {
    assert.ok(GATEWAY_CLIENT_EVENTS.has(eventName), `gateway must accept ${eventName}`)
    assert.ok(statsEvents.has(eventName), `stats must accept ${eventName}`)
  }

  for (const eventName of [
    'ai_request_started',
    'ai_request_completed',
    'ai_request_failed',
    'provider_attempt_started',
    'provider_attempt_completed',
    'provider_attempt_failed',
    'provider_attempt_not_configured'
  ]) {
    assert.ok(statsEvents.has(eventName), `stats must accept gateway-owned ${eventName}`)
  }
})
