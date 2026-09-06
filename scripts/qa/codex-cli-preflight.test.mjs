// Actual CLI config validation only: EMPTY stdin means no prompt/model turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cliArgs } from './codex-fixture-bridge.mjs';

const cli = realpathSync('/Users/tsevdnkanduev/.local/bin/codex');
const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'narra-cli-preflight-')));
const options = { cwd, input: '', encoding: 'utf8', timeout: 5000, maxBuffer: 65536,
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME,
    ...(process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}),
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) } };

test('regression: strict CLI rejects obsolete tools.view_image configuration', () => {
  const args = cliArgs(cwd);
  args.splice(args.length - 1, 0, '-c', 'tools.view_image=false');
  const result = spawnSync(cli, args, options);
  assert.equal(result.status, 1);
  assert.ok(/unknown/i.test(result.stderr) && /tools\.view_image/.test(result.stderr), 'Expected known invalid configuration key');
  assert.equal(result.stdout, '');
});

test('exact bridge CLI flags pass strict config and stop at empty prompt without a turn', () => {
  const result = spawnSync(cli, cliArgs(cwd), options);
  assert.equal(result.status, 1); // Deliberate no-prompt exit, not config failure.
  assert.ok(/No prompt|prompt.*(?:empty|provided)|stdin.*empty/i.test(result.stderr), 'Expected no-prompt terminal condition');
  assert.ok(!/unknown|invalid|configuration/i.test(result.stderr));
  assert.equal(result.stdout, '');
});
