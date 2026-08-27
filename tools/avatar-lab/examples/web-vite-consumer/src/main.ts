import { createAvatar } from '@bible-strong/avatar-web'

import definition from '../../react-vite-consumer/src/strobi.avatar.json'
import './styles.css'

const avatar = createAvatar('#avatar', {
  definition,
  defaultAnimation: 'sleeping',
  size: '100%',
})

document.querySelectorAll<HTMLButtonElement>('[data-animation]').forEach(button => {
  button.addEventListener('click', () => avatar.play(button.dataset.animation ?? 'idle'))
})
document.querySelectorAll<HTMLButtonElement>('[data-expression]').forEach(button => {
  button.addEventListener('click', () =>
    avatar.setExpression(button.dataset.expression ?? 'neutral')
  )
})
document.querySelector('#pause')?.addEventListener('click', () => avatar.pause())
document.querySelector('#stop')?.addEventListener('click', () => avatar.stop())
