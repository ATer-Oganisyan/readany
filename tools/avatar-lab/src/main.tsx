import { accentColors, baseColors, primaryColors } from '@deslop/primitives'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './app/App'
import './app/styles.css'

const color = (
  collection: ReadonlyArray<{ name: string; light: string; dark: string }>,
  name: string,
  appearance: 'light' | 'dark'
) => collection.find(token => token.name === name)?.[appearance]

const rootStyle = document.documentElement.style
rootStyle.setProperty(
  '--narra-background',
  color(baseColors, 'Background Primary', 'dark') ?? '#111111'
)
rootStyle.setProperty('--narra-surface', color(baseColors, 'Elevation 1', 'light') ?? '#ffffff')
rootStyle.setProperty('--narra-foreground', color(primaryColors, 'Primary', 'light') ?? '#111111')
rootStyle.setProperty('--narra-muted', color(primaryColors, 'Primary 50', 'light') ?? '#11111180')
rootStyle.setProperty('--narra-accent', color(accentColors, 'Orange', 'dark') ?? '#ff9230')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
