/** Keep deployment defaults while permitting an explicit local bind address. */
export function listenGateway(app, port, callback, env = process.env) {
  const host = String(env.GATEWAY_HOST || '').trim()
  return host ? app.listen(port, host, callback) : app.listen(port, callback)
}
