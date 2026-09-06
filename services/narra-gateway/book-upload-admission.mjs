import { createPersistentBudgetMiddleware } from './security.mjs'

export function createBookUploadByteBudget({ registry, perInstallationLimit, globalLimit }) {
  return createPersistentBudgetMiddleware({
    registry, metric: 'import_bytes', perInstallationLimit, globalLimit,
    // Filled only after admission validates framing and the hard body cap.
    amount: (req) => Number(req.bookUploadBudgetBytes)
  })
}

// The shared import gate must be acquired before express.raw attaches a reader.
// Waiting sockets hold no application body buffers; every exit removes listeners
// and cancels an in-flight object-store request through bookUploadSignal.
export function createBookUploadAdmission({ gate, authorize, maxBytes, timeoutMs = 120_000 }) {
  return (req, res, next) => {
    if (!gate?.acquire) {
      return next(Object.assign(new Error('Загрузка книги временно недоступна'), {
        code: 'UPLOAD_UNAVAILABLE', status: 503
      }))
    }
    const controller = new AbortController()
    req.bookUploadSignal = controller.signal
    let releaseSlot
    let ended = false
    let timer
    const finish = () => cleanup(false)
    const disconnect = () => cleanup(true)
    function cleanup(abort, reason = new Error('Book upload disconnected')) {
      if (ended) return
      ended = true
      clearTimeout(timer)
      req.removeListener('aborted', disconnect)
      req.removeListener('error', disconnect)
      res.removeListener('finish', finish)
      res.removeListener('close', disconnect)
      res.removeListener('error', disconnect)
      if (abort) controller.abort(reason)
      releaseSlot?.()
    }
    function fail(error) {
      if (ended) return
      cleanup(true, error)
      next(error)
    }
    req.once('aborted', disconnect)
    req.once('error', disconnect)
    res.once('finish', finish)
    res.once('close', disconnect)
    res.once('error', disconnect)
    timer = setTimeout(() => {
      fail(Object.assign(new Error('Время загрузки книги истекло'), {
        code: 'UPLOAD_TIMEOUT', status: 408
      }))
      req.destroy()
    }, timeoutMs)
    timer.unref?.()

    void (async () => {
      if (req.aborted || req.destroyed) return disconnect()
      await authorize(req)
      if (ended) return
      const length = req.headers['content-length']
      if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
        throw Object.assign(new Error('Content-Length: invalid value'), { code: 'VALIDATION', status: 400 })
      }
      if (length !== undefined && Number(length) === 0) {
        throw Object.assign(new Error('Файл книги пуст'), { code: 'VALIDATION', status: 400 })
      }
      if (Number(length) > maxBytes) {
        throw Object.assign(new Error('Файл книги превышает допустимый размер'), {
          code: 'UPLOAD_TOO_LARGE', status: 413
        })
      }
      // HTTP framing bounds a declared body; chunked/unknown-length requests
      // retain a conservative full-cap reservation, including failed attempts.
      req.bookUploadBudgetBytes = length === undefined ? maxBytes : Number(length)
      const release = await gate.acquire(controller.signal)
      // A disconnect may race the resolved acquisition microtask.
      if (ended) { release(); return }
      releaseSlot = release
      next()
    })().catch(fail)
  }
}
