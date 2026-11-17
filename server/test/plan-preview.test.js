import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

test('AI preview falls back to deterministic scheduling when DeepSeek is unavailable', async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'temporary upstream failure' }));
  });
  await new Promise((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen));
  const upstreamPort = upstream.address().port;
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-preview-test-'));
  const database = join(directory, 'test.sqlite');
  const child = spawn(process.execPath, [resolve('server/index.js')], {
    env: {
      ...process.env,
      DB_FILE: database,
      PORT: '0',
      JWT_SECRET: randomBytes(32).toString('hex'),
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${upstreamPort}/chat/completions`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = once(child, 'exit');
  try {
    const port = await new Promise((resolvePort, reject) => {
      const timeout = setTimeout(() => reject(new Error(`API startup timeout: ${output}`)), 10000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/weeklyboard api listening (\d+)/);
        if (match) { clearTimeout(timeout); resolvePort(Number(match[1])); }
      });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(output)); });
    });
    async function request(path, body) {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(body?.token ? { Authorization: `Bearer ${body.token}` } : {}) },
        body: JSON.stringify(body?.payload ?? body),
      });
      return { status: response.status, body: await response.json() };
    }
    const registration = await request('/auth/register', { payload: { email: 'fallback@example.test', password: randomBytes(18).toString('hex') } });
    assert.equal(registration.status, 201);
    const preview = await request('/plan/preview', {
      token: registration.body.token,
      payload: {
        tasks: [{ id: 1, title: '本地回退测试', estimate_minutes: 30, priority: 5 }],
        windows: { 周一: [540, 600] },
        fixed: [],
      },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.fallback, true);
    assert.equal(preview.body.blocks.length, 1);
    assert.equal(preview.body.blocks[0].task_id, 1);
    assert.ok(preview.body.warnings.some((warning) => warning.includes('DeepSeek 暂不可用')));
  } finally {
    child.kill();
    await exited;
    upstream.close();
    await rm(directory, { recursive: true, force: true });
  }
});
