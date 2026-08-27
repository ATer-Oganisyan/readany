// @vitest-environment jsdom

import { act, render } from '@testing-library/react'
import { motionValue } from 'motion'

import { SvgTransformPath } from '@/features/rendering/components/AvatarCanvas'

it('writes animated matrices to the SVG transform attribute', () => {
  const transform = motionValue('matrix(1 0 0 1 4 8)')
  const { container } = render(
    <svg>
      <SvgTransformPath d="M0 0L10 10" svgTransform={transform} />
    </svg>
  )
  const path = container.querySelector('path')

  expect(path?.getAttribute('transform')).toBe('matrix(1 0 0 1 4 8)')

  act(() => transform.set('matrix(0.8 0.2 -0.2 0.8 12 -6)'))

  expect(path?.getAttribute('transform')).toBe('matrix(0.8 0.2 -0.2 0.8 12 -6)')
})
