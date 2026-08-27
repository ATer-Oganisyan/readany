import narraFaceSvg from '@/assets/narra-face.svg?raw'
import headsetSvg from '@/assets/headset-filled.svg?raw'

import type { AvatarRenderStyle, NarraFaceAccessory } from '@/features/avatar/avatars'
import type { BodyNode } from '@/features/avatar/body'
import {
  renderAvatar,
  type AvatarGeometry,
  type AvatarPose,
  type EyeEditorGeometry,
  type Point3,
  type RenderAvatarOptions,
} from '@/features/avatar/geometry'
import type { SurfaceConfig } from '@/features/avatar/surfaces'

type Matrix = readonly [number, number, number, number, number, number]

export type AvatarPathTransforms = {
  kind: 'narra-face'
  back: string[]
  head: string
  left: string
  right: string
  front: string[]
}

export type StudioAvatarGeometry = AvatarGeometry & {
  pathTransforms?: AvatarPathTransforms
}

const pathValues = [...narraFaceSvg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1])

if (pathValues.length !== 4) {
  throw new Error(`Expected four paths in narra-face.svg, received ${pathValues.length}`)
}

const [nosePath, leftEyePath, rightEyePath, browPath] = pathValues
const headsetPathValues = [...headsetSvg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(
  match => match[1]
)

if (headsetPathValues.length !== 1) {
  throw new Error(`Expected one path in headset-filled.svg, received ${headsetPathValues.length}`)
}

const [headsetPath] = headsetPathValues

const SOURCE_CENTER = { x: 75.96, y: 93.14 }
const SOURCE_SCALE = 1.23
const LEFT_EYE_CENTER = { x: 44.39, y: 99.4 }
const RIGHT_EYE_CENTER = { x: 118.26, y: 76.44 }
const EYE_SOURCE_WIDTH = 46.9
const EYE_SOURCE_HEIGHT = 66.6

const NARRA_NEUTRAL = {
  width: 47,
  height: 67,
  spacing: 74,
  positionY: -7,
}

const identity: Matrix = [1, 0, 0, 1, 0, 0]
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
const scale = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0]
const rotate = (degrees: number): Matrix => {
  const angle = (degrees * Math.PI) / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return [cosine, sine, -sine, cosine, 0, 0]
}
const skewX = (degrees: number): Matrix => [1, 0, Math.tan((degrees * Math.PI) / 180), 1, 0, 0]
const skewY = (degrees: number): Matrix => [1, Math.tan((degrees * Math.PI) / 180), 0, 1, 0, 0]

const multiply = (left: Matrix, right: Matrix): Matrix => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
]

const compose = (...matrices: Matrix[]) => matrices.reduce(multiply, identity)
const around = (center: { x: number; y: number }, matrix: Matrix) =>
  compose(translate(center.x, center.y), matrix, translate(-center.x, -center.y))
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))
const matrixValue = (matrix: Matrix) =>
  `matrix(${matrix.map(value => Number(value.toFixed(5))).join(' ')})`
const transformPoint = (matrix: Matrix, x: number, y: number): Point3 => [
  matrix[0] * x + matrix[2] * y + matrix[4],
  matrix[1] * x + matrix[3] * y + matrix[5],
  0,
]

const baseMatrix = compose(
  scale(SOURCE_SCALE, SOURCE_SCALE),
  translate(-SOURCE_CENTER.x, -SOURCE_CENTER.y)
)
const headsetToFaceMatrix = compose(
  translate(SOURCE_CENTER.x, SOURCE_CENTER.y),
  scale(10, 8.5),
  translate(-12, -12)
)

const faceMatrices = (
  pose: AvatarPose,
  blink: number,
  eyeOffset: Readonly<{ x: number; y: number }>
) => {
  const expression = pose.expression
  const horizontalTurn = clamp(expression.headY / 25, -1, 1)
  const verticalTurn = clamp(expression.headX / 25, -1, 1)
  const perspective = clamp(expression.perspective, 0.6, 1.4)
  const horizontalScale = Math.max(0.38, Math.cos((expression.headY * Math.PI) / 180))
  const verticalScale = Math.max(0.46, Math.cos((expression.headX * Math.PI) / 180))
  const headMotion = compose(
    rotate(expression.headZ),
    skewY(verticalTurn * 3.2),
    skewX(-horizontalTurn * 4.2),
    scale(horizontalScale * perspective, verticalScale * perspective)
  )
  const global = compose(headMotion, baseMatrix)

  const layer = (local: Matrix) => compose(global, local)
  const nose = layer(
    compose(translate(horizontalTurn * 12, verticalTurn * 5), skewX(horizontalTurn * 4))
  )
  const brow = layer(
    compose(
      translate(horizontalTurn * 7, verticalTurn * 8 - Math.abs(horizontalTurn) * 10),
      around({ x: 38.4, y: 49.36 }, rotate(horizontalTurn * 4 - verticalTurn * 2))
    )
  )

  const eyeMatrix = (side: -1 | 1) => {
    const suffix = side < 0 ? 'Left' : 'Right'
    const center = side < 0 ? LEFT_EYE_CENTER : RIGHT_EYE_CENTER
    const width = Math.max(4, expression[`width${suffix}`])
    const restingHeight = Math.max(5, expression[`height${suffix}`])
    const height = 5 + (restingHeight - 5) * clamp(blink, 0, 1)
    const spacing = (side * (expression.spacing - NARRA_NEUTRAL.spacing)) / 2
    const x = expression[`positionX${suffix}`] + spacing + eyeOffset.x
    const y = expression[`positionY${suffix}`] - NARRA_NEUTRAL.positionY + eyeOffset.y
    const localEye = compose(
      translate(x, y),
      around(
        center,
        compose(
          rotate(side < 0 ? expression.leftAngle : expression.rightAngle),
          scale(width / NARRA_NEUTRAL.width, height / NARRA_NEUTRAL.height)
        )
      )
    )
    const parallax = compose(
      translate(
        horizontalTurn * 10 + side * Math.abs(horizontalTurn) * 1.4,
        verticalTurn * 6 - Math.abs(horizontalTurn) * 5
      ),
      skewX(horizontalTurn * 3)
    )
    return layer(compose(parallax, localEye))
  }

  return {
    headset: compose(global, headsetToFaceMatrix),
    nose,
    brow,
    left: eyeMatrix(-1),
    right: eyeMatrix(1),
  }
}

export const renderNarraFace = (
  pose: AvatarPose,
  blink = 1,
  options: Pick<RenderAvatarOptions, 'eyeOffset'> = {},
  accessory?: NarraFaceAccessory
): StudioAvatarGeometry => {
  const matrices = faceMatrices(pose, blink, options.eyeOffset ?? { x: 0, y: 0 })
  const hasHeadset = accessory === 'headset'
  return {
    backPaths: hasHeadset ? [headsetPath] : [],
    frontPaths: [browPath],
    backNodeIds: hasHeadset ? [null] : [],
    frontNodeIds: [null],
    headPath: nosePath,
    leftPath: leftEyePath,
    rightPath: rightEyePath,
    leftVisible: true,
    rightVisible: true,
    wirePaths: [],
    pathTransforms: {
      kind: 'narra-face',
      back: hasHeadset ? [matrixValue(matrices.headset)] : [],
      head: matrixValue(matrices.nose),
      left: matrixValue(matrices.left),
      right: matrixValue(matrices.right),
      front: [matrixValue(matrices.brow)],
    },
  }
}

export const renderAvatarByStyle = (
  pose: AvatarPose,
  surface: SurfaceConfig,
  blink: number,
  renderStyle: AvatarRenderStyle,
  options: RenderAvatarOptions = {}
): StudioAvatarGeometry =>
  renderStyle.type === 'narra-face'
    ? renderNarraFace(pose, blink, options, renderStyle.accessory)
    : renderAvatar(pose, surface, blink, options)

const pathFromPoints = (points: Point3[]) =>
  `M${points.map(point => `${point[0].toFixed(2)} ${point[1].toFixed(2)}`).join('L')}Z`
const line = (from: Point3, to: Point3) =>
  `M${from[0].toFixed(2)} ${from[1].toFixed(2)}L${to[0].toFixed(2)} ${to[1].toFixed(2)}`

export const renderNarraEyeEditor = (pose: AvatarPose, side: -1 | 1): EyeEditorGeometry => {
  const matrices = faceMatrices(pose, 1, { x: 0, y: 0 })
  const matrix = side < 0 ? matrices.left : matrices.right
  const centerSource = side < 0 ? LEFT_EYE_CENTER : RIGHT_EYE_CENTER
  const oppositeMatrix = side < 0 ? matrices.right : matrices.left
  const oppositeCenterSource = side < 0 ? RIGHT_EYE_CENTER : LEFT_EYE_CENTER
  const center = transformPoint(matrix, centerSource.x, centerSource.y)
  const oppositeCenter = transformPoint(
    oppositeMatrix,
    oppositeCenterSource.x,
    oppositeCenterSource.y
  )
  const halfWidth = EYE_SOURCE_WIDTH / 2
  const halfHeight = EYE_SOURCE_HEIGHT / 2
  const widthHandle = transformPoint(matrix, centerSource.x + halfWidth + 8, centerSource.y)
  const heightHandle = transformPoint(matrix, centerSource.x, centerSource.y - halfHeight - 8)
  const rotateHandle = transformPoint(matrix, centerSource.x, centerSource.y - halfHeight - 27)
  const sizeHandle = transformPoint(
    matrix,
    centerSource.x + halfWidth + 10,
    centerSource.y + halfHeight + 10
  )
  const leftCenter = side < 0 ? center : oppositeCenter
  const rightCenter = side < 0 ? oppositeCenter : center
  const spacingMiddle: Point3 = [
    (leftCenter[0] + rightCenter[0]) / 2,
    (leftCenter[1] + rightCenter[1]) / 2,
    0,
  ]
  const spacingHandle: Point3 = [spacingMiddle[0], spacingMiddle[1] + 42, 0]
  const corners = [
    transformPoint(matrix, centerSource.x - halfWidth - 3, centerSource.y - halfHeight - 3),
    transformPoint(matrix, centerSource.x + halfWidth + 3, centerSource.y - halfHeight - 3),
    transformPoint(matrix, centerSource.x + halfWidth + 3, centerSource.y + halfHeight + 3),
    transformPoint(matrix, centerSource.x - halfWidth - 3, centerSource.y + halfHeight + 3),
  ]
  return {
    visible: true,
    selectionPath: pathFromPoints(corners),
    widthGuide: line(center, widthHandle),
    heightGuide: line(center, heightHandle),
    rotationGuide: line(heightHandle, rotateHandle),
    spacingGuide: `${line(leftCenter, rightCenter)}${line(spacingMiddle, spacingHandle)}`,
    center,
    widthHandle,
    heightHandle,
    rotateHandle,
    sizeHandle,
    spacingHandle,
  }
}
