const providerFailures = new Map()

export function recordProviderFailure(provider, category) {
  const safeProvider = /^[a-z][a-z0-9_-]{1,39}$/.test(String(provider))
    ? String(provider)
    : 'unknown'
  const safeCategory = ['429', '5xx', 'timeout', 'network'].includes(String(category))
    ? String(category)
    : 'other'
  const key = `${safeProvider}:${safeCategory}`
  providerFailures.set(key, (providerFailures.get(key) ?? 0) + 1)
}

export function operationalRuntimeMetrics() {
  return {
    providerFailures: [...providerFailures.entries()]
      .map(([key, count]) => {
        const [provider, category] = key.split(':')
        return { provider, category, count }
      })
      .sort((left, right) => `${left.provider}:${left.category}`.localeCompare(
        `${right.provider}:${right.category}`
      ))
  }
}

export function resetOperationalRuntimeMetricsForTests() {
  providerFailures.clear()
}
