import https from 'node:https';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Worker } from 'node:worker_threads';

export const MAX_FEED_BYTES = 2 * 1024 * 1024;
export const SYNC_INTERVAL = 30 * 60 * 1000;
export const feedError = (message) => Object.assign(new Error(message), { calendarError: true });

export function normalizeFeedUrl(value) {
  try {
    const url = new URL(String(value || '').trim().replace(/^webcal:/i, 'https:'));
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.href.length > 4096) throw new Error();
    url.hash = '';
    return url.href;
  } catch { throw feedError('请输入有效的 HTTPS 或 webcal 日历订阅链接'); }
}

export function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

export async function fetchCalendar(value) {
  const initial = new URL(normalizeFeedUrl(value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    let url = initial;
    for (let redirect = 0; redirect < 4; redirect++) {
      const addresses = await Promise.race([
        lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true }),
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error()), { once: true })),
      ]);
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw feedError('订阅仅支持公开的互联网日历地址');
      // Pin the validated address to the connection to prevent DNS rebinding.
      const { address, family } = addresses[0];
      const response = await new Promise((resolve, reject) => {
        const request = https.get(url, {
          signal: controller.signal,
          headers: { Accept: 'text/calendar', 'Accept-Encoding': 'identity', 'User-Agent': 'WeeklyBoard/1.0' },
          lookup: (_host, options, callback) => options.all ? callback(null, [{ address, family }]) : callback(null, address, family),
        }, resolve);
        request.on('error', reject);
      });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        const next = new URL(response.headers.location || '', url);
        if (next.origin !== initial.origin) throw feedError('日历跳转到了其他网站，请使用最终的日历订阅地址');
        url = new URL(normalizeFeedUrl(next.href));
        continue;
      }
      if (response.statusCode !== 200) {
        response.resume();
        throw feedError(`日历服务器返回 ${response.statusCode}，请检查链接是否过期或需要登录`);
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response) {
        size += chunk.length;
        if (size > MAX_FEED_BYTES) { response.destroy(); throw feedError('日历文件超过 2 MB，暂时无法同步'); }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    }
    throw feedError('日历跳转次数过多');
  } catch (error) {
    if (error.calendarError) throw error;
    throw feedError('无法连接日历服务器或请求超时；已有日程未改动，请稍后重试');
  } finally { clearTimeout(timer); }
}

export function parseCalendar(raw, options = {}) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_FEED_BYTES) return Promise.reject(feedError('日历文件超过 2 MB'));
  // Untrusted recurrence rules run off the API thread with a hard time limit.
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./calendar-parser.js', import.meta.url), {
      workerData: { raw, options }, stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    const timer = setTimeout(() => { worker.terminate(); reject(feedError('日历过于复杂，无法在限定时间内解析')); }, 8000);
    worker.stdout.resume(); worker.stderr.resume();
    worker.once('message', (result) => {
      clearTimeout(timer);
      if (result.error) reject(feedError(result.error)); else resolve(result);
    });
    worker.once('error', () => { clearTimeout(timer); reject(feedError('日历解析失败，已有日程未改动')); });
    worker.once('exit', (code) => { clearTimeout(timer); if (code) reject(feedError('日历解析未完成，已有日程未改动')); });
  });
}
