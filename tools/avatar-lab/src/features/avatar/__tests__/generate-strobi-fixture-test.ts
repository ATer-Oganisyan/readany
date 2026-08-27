import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

it('keeps the lab artwork synchronized with the Narra app face SVG', async () => {
  const [appFace, labFace, publicFace] = await Promise.all([
    readFile(resolve('../../packages/app-expo/assets/narra-face.svg'), 'utf8'),
    readFile(resolve('src/assets/narra-face.svg'), 'utf8'),
    readFile(resolve('public/narra-face.svg'), 'utf8'),
  ])

  expect(labFace).toBe(appFace)
  expect(publicFace).toBe(appFace)
})

it('keeps the provided headset artwork synchronized across the app and lab', async () => {
  const [appHeadset, labHeadset, publicHeadset] = await Promise.all([
    readFile(resolve('../../packages/app-expo/assets/headset-filled.svg'), 'utf8'),
    readFile(resolve('src/assets/headset-filled.svg'), 'utf8'),
    readFile(resolve('public/headset-filled.svg'), 'utf8'),
  ])

  expect(labHeadset).toBe(appHeadset)
  expect(publicHeadset).toBe(appHeadset)
  expect(appHeadset.match(/<path\b/g)).toHaveLength(1)
})
