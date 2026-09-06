// Model-free macOS containment diagnostic. Never reads real credentials.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await realpath(await mkdtemp(join(tmpdir(), 'narra-sandbox-probe-')));
const inside = join(root, 'fixture');
const outside = join(root, 'outside');
const cli = await realpath('/Users/tsevdnkanduev/.local/bin/codex');
await mkdir(inside);
await mkdir(outside);
await writeFile(join(inside, 'allowed.txt'), 'NARRA_ALLOWED_SENTINEL');
await writeFile(join(outside, 'denied.txt'), 'NARRA_OUTSIDE_SENTINEL');
await symlink(join(outside, 'denied.txt'), join(inside, 'escape.txt'));

let tcpRequests = 0;
let socketRequests = 0;
const tcp = createServer((_req, res) => { tcpRequests++; res.end('probe'); });
const socket = createServer((_req, res) => { socketRequests++; res.end('probe'); });
await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve));
const socketPath = join(inside, 'probe.sock');
await new Promise((resolve) => socket.listen(socketPath, resolve));

// TOML inline map is deliberately constructed from known paths only, no shell.
const filesystem = `permissions.narra-probe.filesystem={ ${[
  [':root', 'deny'], [':minimal', 'read'], [inside, 'read'], [cli, 'read'],
].map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(', ')} }`;
const config = [
  '-P', 'narra-probe', '-C', inside,
  '-c', filesystem,
  '-c', 'permissions.narra-probe.network.enabled=false',
  '-c', 'approval_policy="never"',
  '-c', 'shell_environment_policy.inherit="none"',
];

function run(command, sandboxed = true, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(sandboxed ? cli : command[0],
      sandboxed ? ['sandbox', ...config, '--', ...command] : command.slice(1), {
        cwd: inside, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'],
      });
    let output = '';
    let error = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.stdout.on('data', (data) => { output += data; if (output.length > 65536) child.kill('SIGKILL'); });
    child.stderr.on('data', (data) => { error += data; if (error.length > 65536) child.kill('SIGKILL'); });
    child.on('error', () => { clearTimeout(timer); resolve({ code: null, launchError: true }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output, denied: /not permitted|permission denied|sandbox/i.test(error) });
    });
  });
}

const results = [];
async function check(name, command, expected, sandboxed = true, extraEnv = {}) {
  const result = await run(command, sandboxed, extraEnv);
  results.push({ name, pass: expected(result), exitCode: result.code, deniedDiagnostic: result.denied ?? false });
}

try {
  await check('canonical trusted CLI executable can bootstrap', [cli, '--version'], r => r.code === 0 && /^codex-cli 0\.153\.3\s*$/.test(r.output));
  await check('control: outside sentinel exists/readable', ['/bin/cat', join(outside, 'denied.txt')], r => r.code === 0 && r.output === 'NARRA_OUTSIDE_SENTINEL', false);
  await check('inside fixture readable', ['/bin/cat', join(inside, 'allowed.txt')], r => r.code === 0 && r.output === 'NARRA_ALLOWED_SENTINEL');
  await check('outside fixture unreadable', ['/bin/cat', join(outside, 'denied.txt')], r => r.code !== 0 && r.denied && !r.output?.includes('NARRA_OUTSIDE_SENTINEL'));
  await check('symlink cannot reopen outside', ['/bin/cat', join(inside, 'escape.txt')], r => r.code !== 0 && r.denied && !r.output?.includes('NARRA_OUTSIDE_SENTINEL'));
  await check('inside fixture unwritable', ['/usr/bin/touch', join(inside, 'must-not-exist')], r => r.code !== 0 && r.denied);
  await check('outside fixture unwritable', ['/usr/bin/touch', join(outside, 'must-not-exist')], r => r.code !== 0 && r.denied);
  const tcpCommand = ['/usr/bin/curl', '--silent', '--show-error', '--connect-timeout', '1', '--max-time', '2', `http://127.0.0.1:${tcp.address().port}/`];
  await check('control: own loopback HTTP reachable', tcpCommand, r => r.code === 0 && r.output === 'probe', false);
  const tcpBefore = tcpRequests;
  await check('loopback HTTP blocked', tcpCommand, r => r.code !== 0 && tcpRequests === tcpBefore);
  const unixCommand = ['/usr/bin/curl', '--silent', '--show-error', '--max-time', '2', '--unix-socket', socketPath, 'http://localhost/'];
  await check('control: own Unix socket reachable', unixCommand, r => r.code === 0 && r.output === 'probe', false);
  const socketBefore = socketRequests;
  await check('Unix socket blocked', unixCommand, r => r.code !== 0 && socketRequests === socketBefore);
  // Direct sandbox CLI is not necessarily the agent's tool environment builder.
  // This comparison identifies that distinction without printing environment.
  await check('control: synthetic environment reaches ordinary child', ['/bin/sh', '-c', 'test "$NARRA_QA_MARKER" = harmless'], r => r.code === 0, false, { NARRA_QA_MARKER: 'harmless' });
  await check('direct sandbox helper filters non-secret environment marker', ['/bin/sh', '-c', 'test -z "$NARRA_QA_MARKER"'], r => r.code === 0, true, { NARRA_QA_MARKER: 'harmless' });
  await check('direct sandbox helper filters synthetic environment', ['/bin/sh', '-c', 'test -z "$NARRA_SYNTHETIC_SECRET"'], r => r.code === 0, true, { NARRA_SYNTHETIC_SECRET: 'not-a-real-secret' });
} finally {
  tcp.closeAllConnections(); socket.closeAllConnections();
  await Promise.all([new Promise(resolve => tcp.close(resolve)), new Promise(resolve => socket.close(resolve))]);
}
console.log(JSON.stringify({ fixtureRoot: root, results }, null, 2));
process.exitCode = results.every(result => result.pass) ? 0 : 1;
