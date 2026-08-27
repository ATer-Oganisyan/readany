import { quantizePixelArtPixels } from '@/features/rendering/pixelRenderer'

describe('pixel art renderer', () => {
  it('removes antialiased transparency and mixed edge colors', () => {
    const pixels = new Uint8ClampedArray([91, 127, 229, 90, 88, 122, 221, 220, 24, 25, 31, 255])

    quantizePixelArtPixels(pixels, '#5b7fe5', '#111316')

    expect([...pixels]).toEqual([0, 0, 0, 0, 91, 127, 229, 255, 17, 19, 22, 255])
  })

  it('uses a deterministic hard threshold for boundary pixels', () => {
    const pixels = new Uint8ClampedArray([91, 127, 229, 127, 91, 127, 229, 128])

    quantizePixelArtPixels(pixels, '#5b7fe5', '#111316')

    expect([...pixels]).toEqual([0, 0, 0, 0, 91, 127, 229, 255])
  })
})
