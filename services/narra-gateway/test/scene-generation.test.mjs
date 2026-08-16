import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSceneJobBody, sceneGenerationPrompt } from '../scene-generation.mjs'

const requestId = '11111111-1111-4111-8111-111111111111'

test('scene jobs accept structured facts and build the provider prompt on the server', () => {
  const input = parseSceneJobBody({
    request_id: requestId,
    book_title: 'Преступление и наказание',
    book_author: 'Фёдор Достоевский',
    chapter: 'Часть первая',
    excerpt: 'Раскольников медленно спускался по лестнице.',
    characters: [{
      name: 'Раскольников',
      full_name: 'Родион Раскольников',
      role: 'студент',
      gender: 'male',
      appearance: 'худой молодой человек в старом пальто'
    }],
    previous_excerpts: []
  })
  assert.equal(input.requestId, requestId)
  const prompt = sceneGenerationPrompt(input)
  assert.match(prompt, /Родион Раскольников/)
  assert.match(prompt, /Раскольников медленно спускался/)
  assert.match(prompt, /без текста/)
})

test('scene jobs reject raw provider controls and malformed ids', () => {
  assert.throws(() => parseSceneJobBody({
    request_id: requestId,
    book_title: 'Книга',
    excerpt: 'Сцена',
    characters: [],
    previous_excerpts: [],
    model: 'provider/model'
  }), /неизвестное поле/)
  assert.throws(() => parseSceneJobBody({
    request_id: 'request-1',
    book_title: 'Книга',
    excerpt: 'Сцена',
    characters: [],
    previous_excerpts: []
  }), /UUID v4/)
})
