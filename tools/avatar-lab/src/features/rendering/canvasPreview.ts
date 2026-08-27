import { applyAvatarEyeDefaults, type AvatarEyeDefaults } from '../avatar/avatars'
import { type Expression } from '../avatar/geometry'
import { defaultExpression } from '../avatar/presets'

export type CanvasPreviewTarget = 'head' | 'eyes'

export const resetBodyEditorView = (expression: Expression): Expression => ({
  ...defaultExpression,
  id: expression.id,
  ...(expression.semanticKey ? { semanticKey: expression.semanticKey } : {}),
})

export const shouldSyncCanvasPreviewToReact = (bodyEditing: boolean, target: CanvasPreviewTarget) =>
  !bodyEditing || target !== 'head'

export const resolveCanvasPreviewExpression = (
  expression: Expression,
  avatarEyes: AvatarEyeDefaults,
  bodyEditing: boolean,
  target: CanvasPreviewTarget
) =>
  bodyEditing && target === 'head' ? applyAvatarEyeDefaults(expression, avatarEyes) : expression
