import { createBodyNode } from '@/features/avatar/body'
import { renderAvatar, poseFromExpression } from '@/features/avatar/geometry'
import { defaultExpression } from '@/features/avatar/presets'
import {
  createRenderedColors,
  createRenderedScene,
  findBodyNodePath,
  paintRenderedColors,
  paintRenderedScene,
} from '@/features/rendering/renderedScene'
import { renderNarraFace } from '@/features/rendering/narraFaceGeometry'
import { surfacePresets } from '@/features/avatar/surfaces'
import defaultStudioDocument from '@/features/studio/defaultStudioDocument.json'
import type { Expression } from '@/features/avatar/geometry'

describe('rendered avatar scene', () => {
  it('keeps layer identity and hit mapping behind the scene seam', () => {
    const node = createBodyNode('sphere', 0)
    const first = renderAvatar(poseFromExpression(defaultExpression), surfacePresets.sphere, 1, {
      bodyNodes: [node],
    })
    const scene = createRenderedScene(first)
    const rotated = renderAvatar(
      poseFromExpression({ ...defaultExpression, headY: 35 }),
      surfacePresets.sphere,
      1,
      { bodyNodes: [node] }
    )

    paintRenderedScene(scene, rotated)

    expect(findBodyNodePath(scene, 'primary')).toBe(scene.headPath)
    expect(findBodyNodePath(scene, node.id)).not.toBeNull()
    expect(scene.headPath.get()).toBe(rotated.headPath)
  })

  it('updates animated colors without replacing their motion values', () => {
    const colors = createRenderedColors({ body: '#5b7fe5', eyes: '#111316' })
    const body = colors.body
    const eyes = colors.eyes

    paintRenderedColors(colors, { body: '#c53b47', eyes: '#ffffff' })

    expect(colors.body).toBe(body)
    expect(colors.eyes).toBe(eyes)
    expect(colors.body.get()).toBe('#c53b47')
    expect(colors.eyes.get()).toBe('#ffffff')
  })

  it('animates the exact Narra SVG layers with stable path identities', () => {
    const expression = defaultStudioDocument.expressions[5] as Expression
    const neutral = renderNarraFace(poseFromExpression(expression), 1, {}, 'headset')
    const turned = renderNarraFace(
      poseFromExpression({ ...expression, headY: 35, headX: -20 }),
      0.25,
      {},
      'headset'
    )
    const blinked = renderNarraFace(poseFromExpression(expression), 0.1, {}, 'headset')
    const scene = createRenderedScene(neutral)

    paintRenderedScene(scene, turned)

    expect(turned.headPath).toBe(neutral.headPath)
    expect(turned.leftPath).toBe(neutral.leftPath)
    expect(turned.rightPath).toBe(neutral.rightPath)
    expect(turned.frontPaths).toEqual(neutral.frontPaths)
    expect(turned.backPaths).toEqual(neutral.backPaths)
    expect(neutral.backPaths).toHaveLength(1)
    expect(blinked.pathTransforms?.back[0]).toBe(neutral.pathTransforms?.back[0])
    expect(scene.headTransform.get()).toBe(turned.pathTransforms?.head)
    expect(scene.backTransforms[0].get()).toBe(turned.pathTransforms?.back[0])
    expect(scene.leftTransform.get()).toBe(turned.pathTransforms?.left)
    expect(scene.rightTransform.get()).toBe(turned.pathTransforms?.right)
    expect(scene.frontTransforms[0].get()).toBe(turned.pathTransforms?.front[0])
  })
})
