#!/usr/bin/env node
// The bundled books and the remote catalog use one XML-aware cleanup pipeline.
// Setup: python3 -m pip install -r scripts/catalog/requirements.txt (repository root).
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const script = fileURLToPath(new URL('../../../scripts/catalog/clean_bundled.py', import.meta.url))
const result = spawnSync(process.env.PYTHON || 'python3', [script], { stdio: 'inherit' })
if (result.error) console.error(result.error.message)
process.exitCode = result.status ?? 1
