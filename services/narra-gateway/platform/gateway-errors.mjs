/**
 * Коды ошибок шлюза и их отображение в HTTP-статус.
 *
 * Раньше обе функции жили в index.mjs, поэтому вынесенные оттуда клиенты
 * провайдеров не могли ими пользоваться, не затянув за собой весь модуль.
 */

const STATUS_BY_CODE = {
  NO_KEY: 400,
  VALIDATION: 400,
  AUTH: 401,
  CENSOR: 422,
  RATE: 429,
  TIMEOUT: 504,
  NETWORK: 502
}

export function httpErr(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function statusFor(code) {
  return STATUS_BY_CODE[code] || 500
}
