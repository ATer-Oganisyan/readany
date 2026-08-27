import { migrateBundledAvatarColors } from '@/features/avatar/avatars'
import { avatarBodyOutlineWidth } from '@/features/rendering/avatarAppearance'

describe('outlined avatar appearance', () => {
  it('uses the same fixed body outline width for every avatar', () => {
    expect(avatarBodyOutlineWidth()).toBe(12)
  })

  it('migrates bundled avatar colors to Deslop accent tokens', () => {
    expect(migrateBundledAvatarColors('strobi', { body: '#5b7fe5', eyes: '#111316' })).toEqual({
      body: '#7c89ff',
      eyes: '#50d7fe',
    })
  })

  it('preserves user-customized colors', () => {
    expect(migrateBundledAvatarColors('strobi', { body: '#123456', eyes: '#654321' })).toEqual({
      body: '#123456',
      eyes: '#654321',
    })
  })
})
