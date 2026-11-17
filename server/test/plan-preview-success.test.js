import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

test('AI preview accepts a valid DeepSeek response and preserves task associations', async () => {
  let received = '';
  let receivedAuthorization = '';
  const upstream = createServer(async (request, response) => {
    receivedAuthorization = request.headers.authorization || '';
    for await (const chunk of request) received += chunk;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: { content: '```json\n{"summary":"AI 草案","blocks":[{"task_id":11,"title":"数学复习","day":"周一","start_minute":540,"end_minute":570,"category":"study"},{"task_id":null,"title":"英语阅读","day":"周一","start_minute":600,"end_minute":630,"category":"study"}],"warnings":[]}\n```' } }],
    }));
  });
  await new Promise((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen));
  const upstreamPort = upstream.address().port;
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-preview-success-'));
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
    const registration = await request('/auth/register', { payload: { email: 'success@example.test', password: randomBytes(18).toString('hex') } });
    assert.equal(registration.status, 201);
    const preview = await request('/plan/preview', {
      token: registration.body.token,
      payload: {
        tasks: [
          { id: 11, title: '数学复习', estimate_minutes: 30, priority: 5 },
          { id: 12, title: '英语阅读', estimate_minutes: 30, priority: 4 },
        ],
        windows: { 周一: [540, 660] },
        fixed: [],
      },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.fallback, undefined);
    assert.deepEqual(preview.body.blocks.map((block) => block.task_id), [11, 12]);
    assert.match(received, /数学复习/);
    assert.equal(receivedAuthorization, 'Bearer test-key');
  } finally {
    child.kill();
    await exited;
    upstream.close();
    await rm(directory, { recursive: true, force: true });
  }
});
