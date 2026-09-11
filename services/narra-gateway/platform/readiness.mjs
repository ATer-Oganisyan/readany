export function gatewayReadiness({
  llmReady,
  speechReady,
  imageReady,
  storageReady,
  videoConfigured,
  videoTransportAccepted,
  videoRequired,
  videoTransportSecure,
  llmTransportSecure,
  environment,
  bookBackendRequired = false,
  bookBackendReady = false
}) {
  const videoReady = !videoRequired || (videoConfigured && videoTransportAccepted)
  const bookReady = !bookBackendRequired || bookBackendReady
  const degraded = []
  if (!videoRequired && !videoConfigured) {
    degraded.push({ code: 'VIDEO_NOT_CONFIGURED', environment })
  } else if (videoConfigured && !videoTransportSecure) {
    degraded.push({ code: 'VIDEO_PLAINTEXT_HTTP', environment })
  }
  if (!llmTransportSecure) {
    degraded.push({ code: 'LLM_PLAINTEXT_HTTP', environment })
  }
  return {
    ready: llmReady && speechReady && imageReady && storageReady && videoReady && bookReady,
    degraded,
    checks: {
      llm: llmReady,
      speech: speechReady,
      image: imageReady,
      storage: storageReady,
      video: videoReady,
      video_required: videoRequired,
      book_backend: bookReady,
      book_backend_required: bookBackendRequired
    }
  }
}
