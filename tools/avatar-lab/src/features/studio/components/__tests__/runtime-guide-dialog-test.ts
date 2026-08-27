import { buildRuntimeGuideText } from '@/features/studio/components/RuntimeGuideDialog'

describe('runtime usage guide copy', () => {
  it('copies the complete React guide with the selected animation', () => {
    const guide = buildRuntimeGuideText({
      animationKey: 'friendly-wave',
      integration: 'react',
      t: text => text,
    })

    expect(guide).toContain('# Guide d’utilisation de l’avatar React')
    expect(guide).toContain('npm install @bible-strong/avatar-react react react-dom')
    expect(guide).toContain('defaultAnimation="friendly-wave"')
    expect(guide).toContain('## Props de l’avatar')
    expect(guide).toContain('`onAnimationEnd`')
    expect(guide).toContain('## Avatar générique')
    expect(guide).toContain('## API impérative')
    expect(guide).toContain('`getState()`')
  })

  it('copies the complete JavaScript guide with browser and controller instructions', () => {
    const guide = buildRuntimeGuideText({
      integration: 'javascript',
      t: text => text,
    })

    expect(guide).toContain('# Guide d’utilisation de l’avatar JavaScript')
    expect(guide).toContain('npm install @bible-strong/avatar-web')
    expect(guide).toContain("defaultExpression: 'neutral'")
    expect(guide).toContain('## Options de createAvatar')
    expect(guide).toContain('`destroy()`')
    expect(guide).toContain('## Navigateur sans bundler')
    expect(guide).toContain("await fetch('./avatar.avatar.json')")
  })
})
