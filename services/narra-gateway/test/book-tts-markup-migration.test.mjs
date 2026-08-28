import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sql = await readFile(new URL('../migrations/018_book_tts_markup.sql', import.meta.url), 'utf8')

test('TTS markup has independent durable jobs and immutable publications', () => {
  assert.match(sql, /CREATE TABLE book_tts_markup_jobs/)
  assert.match(sql, /status TEXT NOT NULL CHECK \(status IN \('queued', 'running', 'ready', 'failed'\)\)/)
  assert.match(sql, /source_publication_id UUID NOT NULL REFERENCES book_analysis_publications/)
  assert.match(sql, /CREATE TABLE book_tts_markup_publications/)
  assert.match(sql, /CREATE TRIGGER book_tts_markup_publications_immutable/)
  assert.match(sql, /UNIQUE \(source_publication_id, analysis_version\)/)
})
