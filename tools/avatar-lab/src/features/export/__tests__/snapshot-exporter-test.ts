import { poseFromExpression, renderAvatar } from '@/features/avatar/geometry'
import { defaultExpression } from '@/features/avatar/presets'
import { createRenderedScene, paintRenderedOffset } from '@/features/rendering/renderedScene'
import {
  serializeAvatarSnapshot,
  serializePixelSnapshot,
  snapshotFileName,
} from '@/features/export/snapshotExporter'
import { surfacePresets } from '@/features/avatar/surfaces'
import { renderNarraFace } from '@/features/rendering/narraFaceGeometry'

describe('avatar snapshot export', () => {
  const geometry = renderAvatar(poseFromExpression(defaultExpression), surfacePresets.sphere, 1)
  const scene = createRenderedScene(geometry)
  const colors = { body: '#5b7fe5', eyes: '#111316' }

  it('exports the currently rendered scene as a transparent SVG', () => {
    paintRenderedOffset(scene, { x: 3, y: -2 })
    const svg = serializeAvatarSnapshot('Strobi', scene, colors, {
      background: 'transparent',
      colorFrom: '#ffffff',
      colorTo: '#000000',
      size: 1024,
    })

    expect(svg).toContain('width="1024" height="1024"')
    expect(svg).toContain('transform="translate(3 -2)"')
    expect(svg).toContain(`d="${geometry.headPath}" fill="#5b7fe5"`)
    expect(svg).toContain('fill="#111316"')
    expect(svg).not.toContain('width="300" height="300" fill=')
  })

  it('applies logo framing without changing the rendered avatar scene', () => {
    const svg = serializeAvatarSnapshot('Strobi', scene, colors, {
      background: 'solid',
      colorFrom: '#818181',
      colorTo: '#818181',
      size: 1024,
      composition: { x: 55, y: 65, scale: 1.3, cornerRadius: 18 },
    })

    expect(svg).toContain('<clipPath id="snapshot-frame-clip">')
    expect(svg).toContain('rx="54"')
    expect(svg).toContain('clip-path="url(#snapshot-frame-clip)"')
    expect(svg).toContain('transform="translate(55 65) scale(1.3)"')
    expect(svg).toContain('fill="#818181"')
  })

  it('embeds a radial background without external dependencies', () => {
    const svg = serializeAvatarSnapshot('Strobi', scene, colors, {
      background: 'radial',
      colorFrom: '#ffffff',
      colorTo: '#8899aa',
      size: 512,
    })

    expect(svg).toContain('<radialGradient id="snapshot-radial"')
    expect(svg).toContain('fill="url(#snapshot-radial)"')
    expect(snapshotFileName('Étoile du soir')).toBe('etoile-du-soir-snapshot.svg')
    expect(snapshotFileName('Étoile du soir', 'png')).toBe('etoile-du-soir-snapshot.png')
  })

  it('exports all four exact Narra SVG layers with their animated transforms', () => {
    const narraGeometry = renderNarraFace(
      poseFromExpression({ ...defaultExpression, headX: -12, headY: 24, headZ: 8 }),
      0.45,
      {},
      'headset'
    )
    const narraScene = createRenderedScene(narraGeometry)
    const svg = serializeAvatarSnapshot(
      'Narra Face',
      narraScene,
      { body: '#a1a1a1', eyes: '#a1a1a1' },
      {
        background: 'transparent',
        colorFrom: '#ffffff',
        colorTo: '#000000',
        size: 1024,
      },
      { type: 'narra-face', accessory: 'headset' }
    )

    expect(svg).toContain(
      `d="${narraGeometry.backPaths[0]}" fill="#a1a1a1" opacity="0.58" transform="${narraGeometry.pathTransforms?.back[0]}"`
    )
    expect(svg).toContain(
      `d="${narraGeometry.headPath}" fill="#a1a1a1" opacity="1" transform="${narraGeometry.pathTransforms?.head}"`
    )
    expect(svg).toContain(
      `d="${narraGeometry.leftPath}" fill="#a1a1a1" opacity="1" transform="${narraGeometry.pathTransforms?.left}"`
    )
    expect(svg).toContain(
      `d="${narraGeometry.rightPath}" fill="#a1a1a1" opacity="1" transform="${narraGeometry.pathTransforms?.right}"`
    )
    expect(svg).toContain(
      `d="${narraGeometry.frontPaths[0]}" fill="#a1a1a1" opacity="1" transform="${narraGeometry.pathTransforms?.front[0]}"`
    )
    expect(svg).not.toContain('<g clip-path="url(#snapshot-head-clip)">')
  })

  it('embeds a pixel snapshot as a self-contained raster SVG', () => {
    const svg = serializePixelSnapshot('Pixel & Co', 'data:image/png;base64,AAAA', 256)

    expect(svg).toContain('viewBox="0 0 256 256"')
    expect(svg).toContain('image-rendering="pixelated"')
    expect(svg).toContain('data:image/png;base64,AAAA')
    expect(svg).toContain('aria-label="Pixel &amp; Co"')
  })
})
