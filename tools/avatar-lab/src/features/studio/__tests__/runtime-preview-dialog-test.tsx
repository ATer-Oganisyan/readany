// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { validateAvatarDefinition, type AvatarDefinition } from '@bible-strong/avatar-core'

import definitionJson from '../../../../examples/react-vite-consumer/src/strobi.avatar.json'
import { RuntimePreviewDialog } from '@/features/studio/components/RuntimePreviewDialog'
import { StudioLanguageProvider } from '@/i18n'

const definitionResult = validateAvatarDefinition(definitionJson)
if (!definitionResult.ok) throw new Error('Invalid preview fixture')
const definition = definitionResult.value

const renderPreview = (avatarDefinition: AvatarDefinition, initialAnimation?: string) =>
  render(
    <StudioLanguageProvider>
      <RuntimePreviewDialog
        definition={avatarDefinition}
        initialAnimation={initialAnimation}
        open
        onOpenChange={vi.fn()}
      />
    </StudioLanguageProvider>
  )

describe('runtime export preview', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('exposes the exported animations, expressions and playback controls', () => {
    renderPreview(definition, 'sleeping')

    expect(screen.getByRole('heading', { name: 'Exported definition preview' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Exported animations' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Exported expressions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'idle' }))
    expect(screen.getByRole('button', { name: 'idle' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('previews an expression-only definition and disables Play', () => {
    const expressionOnly = {
      ...definition,
      animations: {},
      animationOrder: [],
    } as AvatarDefinition

    renderPreview(expressionOnly)

    expect(screen.getByText('No exported animation')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText('neutral').length).toBeGreaterThan(0)
  })
})
