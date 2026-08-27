import { applyAvatarEyeDefaults, defaultAvatarEyes } from '@/features/avatar/avatars'
import {
  resetBodyEditorView,
  resolveCanvasPreviewExpression,
  shouldSyncCanvasPreviewToReact,
} from '@/features/rendering/canvasPreview'
import { defaultExpression } from '@/features/avatar/presets'

describe('canvas preview expression', () => {
  it('resets the complete temporary pose when body editing opens', () => {
    const expression = {
      ...defaultExpression,
      id: 'expression-active',
      semanticKey: 'active',
      headX: 24,
      headY: -31,
      headZ: 17,
      spacing: 62,
      leftAngle: 12,
      widthLeft: 44,
      heightRight: 18,
      positionXLeft: 9,
      positionYRight: 14,
      perspective: 3,
      eyeMotion: 'shake' as const,
      bodyMotion: 'slowDrift' as const,
      bodyColor: '#123456',
      eyeColor: '#abcdef',
    }

    expect(resetBodyEditorView(expression)).toEqual({
      ...defaultExpression,
      id: 'expression-active',
      semanticKey: 'active',
    })
  })

  it('keeps body rotation previews in Motion values until the gesture commits', () => {
    expect(shouldSyncCanvasPreviewToReact(true, 'head')).toBe(false)
    expect(shouldSyncCanvasPreviewToReact(true, 'eyes')).toBe(true)
    expect(shouldSyncCanvasPreviewToReact(false, 'head')).toBe(true)
  })

  it('keeps customized neutral eyes applied while rotating the body preview', () => {
    const eyes = {
      ...defaultAvatarEyes,
      widthLeft: 37,
      positionYLeft: -18,
      leftAngle: 21,
      rightAngle: -21,
    }
    const draggedExpression = { ...defaultExpression, headX: 24, headY: 31 }

    expect(resolveCanvasPreviewExpression(draggedExpression, eyes, true, 'head')).toEqual(
      applyAvatarEyeDefaults(draggedExpression, eyes)
    )
  })

  it('does not compose neutral eyes twice outside body editing', () => {
    const eyes = { ...defaultAvatarEyes, widthLeft: 37 }

    expect(resolveCanvasPreviewExpression(defaultExpression, eyes, false, 'head')).toBe(
      defaultExpression
    )
  })

  it('does not compose customized eyes twice while editing an eye handle', () => {
    const eyes = { ...defaultAvatarEyes, widthLeft: 37 }
    const customizedExpression = applyAvatarEyeDefaults(defaultExpression, eyes)

    expect(resolveCanvasPreviewExpression(customizedExpression, eyes, true, 'eyes')).toBe(
      customizedExpression
    )
  })
})
