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
  environment
}) {
  const videoReady = !videoRequired || (videoConfigured && videoTransportAccepted)
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
    ready: llmReady && speechReady && imageReady && storageReady && videoReady,
    degraded,
    checks: {
      llm: llmReady,
      speech: speechReady,
      image: imageReady,
      storage: storageReady,
      video: videoReady,
      video_required: videoRequired
    }
  }
}
