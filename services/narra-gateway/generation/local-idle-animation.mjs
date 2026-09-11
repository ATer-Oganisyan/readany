import { spawn } from 'node:child_process'

const MAX_VIDEO_BYTES = 32 * 1024 * 1024

export function createLocalIdleAnimation(imageBytes, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-loop', '1', '-i', 'pipe:0',
      '-vf', "scale=768:1024:force_original_aspect_ratio=increase,crop=768:1024,zoompan=z='min(zoom+0.0003,1.025)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=96:s=768x1024:fps=24,format=yuv420p",
      '-frames:v', '96', '-an', '-c:v', 'libx264', '-preset', 'veryfast',
      '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    const errors = []
    let total = 0
    const abort = () => child.kill('SIGKILL')
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk) => {
      total += chunk.byteLength
      if (total > MAX_VIDEO_BYTES) return child.kill('SIGKILL')
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      if (errors.reduce((sum, item) => sum + item.byteLength, 0) < 8_192) errors.push(chunk)
    })
    child.on('error', (error) => {
      reject(Object.assign(new Error(`local idle animation is unavailable: ${error.message}`), {
        code: 'VIDEO_UNAVAILABLE'
      }))
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return reject(signal.reason || new Error('idle animation cancelled'))
      if (total > MAX_VIDEO_BYTES) {
        return reject(Object.assign(new Error('local idle animation exceeded 32 MiB'), { code: 'VIDEO_TOO_LARGE' }))
      }
      if (code !== 0 || total === 0) {
        return reject(Object.assign(new Error(
          `local idle animation failed: ${Buffer.concat(errors).toString('utf8').slice(0, 300)}`
        ), { code: 'VIDEO_FAILED' }))
      }
      resolve({ bytes: Buffer.concat(chunks), mimeType: 'video/mp4' })
    })
    child.stdin.end(Buffer.from(imageBytes))
  })
}
