// تست اسکریپت نصب با سرورهای شبیه‌سازی‌شده‌ی Cloudflare / Telegram / GitHub
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');

function startMock({ tgOk = true } = {}) {
  const log = { uploads: [], queries: [], calls: [], webhook: null };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    log.calls.push(req.method + ' ' + p + url.search);
    const cf = (result, success = true, errors = []) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ success, result, errors }));
    };
    const A = '/cf/accounts/acc1';
    if (p === '/cf/accounts') return cf([{ id: 'acc1', name: 'Test Account' }]);
    if (p === A + '/workers/scripts' && req.method === 'GET') return cf([]);
    if (p === A + '/d1/database' && req.method === 'GET') return cf([]);
    if (p === A + '/d1/database' && req.method === 'POST') return cf({ uuid: 'db-uuid-1', name: JSON.parse(raw).name });
    if (p === A + '/d1/database/db-uuid-1/query') {
      log.queries.push(JSON.parse(raw).sql);
      return cf([{ results: [], success: true }]);
    }
    if (p === A + '/workers/subdomain' && req.method === 'GET') return cf(null, false, [{ code: 10007, message: 'subdomain not found' }]);
    if (p === A + '/workers/subdomain' && req.method === 'PUT') return cf({ subdomain: JSON.parse(raw).subdomain });
    if (p.startsWith(A + '/workers/scripts/') && p.endsWith('/subdomain')) return cf({ enabled: true });
    if (p.startsWith(A + '/workers/scripts/') && p.endsWith('/schedules')) {
      log.cron = JSON.parse(raw);
      return cf({ schedules: [] });
    }
    if (p.startsWith(A + '/workers/scripts/') && req.method === 'PUT') {
      assert.match(req.headers['content-type'], /^multipart\/form-data/);
      const body = raw.toString('utf8');
      const m = body.match(/name="metadata"[\s\S]*?\r\n\r\n(\{[\s\S]*?\})\r\n--/);
      log.uploads.push({ name: p.split('/').pop(), meta: JSON.parse(m[1]), hasCode: body.includes('export default') && body.includes('name="index.js"') });
      return cf({ id: p.split('/').pop() });
    }
    if (p === '/worker/boot') {
      log.boot = url.searchParams.get('k');
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ok: true, bot: 'mybot_bot' }));
    }
    if (p.startsWith('/tg/bot')) {
      const method = p.split('/').pop();
      res.setHeader('content-type', 'application/json');
      if (!tgOk) {
        return req.socket.destroy(); // شبیه‌سازی فیلتر شبکه
      }
      if (method === 'getMe') return res.end(JSON.stringify({ ok: true, result: { username: 'mybot_bot', first_name: 'My Bot' } }));
      if (method === 'setWebhook') {
        log.webhook = JSON.parse(raw);
        return res.end(JSON.stringify({ ok: true, result: true }));
      }
      return res.end(JSON.stringify({ ok: true, result: [] }));
    }
    if (p === '/gh/repos/user/repo/contents/src/index.js') return res.end(CODE);
    if (p === '/gh/repos/user/repo/contents/src/eitaa.js') return res.end(fs.readFileSync(path.join(ROOT, 'src/eitaa.js'), 'utf8'));
    if (p === '/gh/repos/user/repo/contents/schema.sql') return res.end(SCHEMA);
    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, errors: [{ message: 'mock 404 ' + p }] }));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, log, port: server.address().port })));
}

function runSetup(env) {
  return new Promise((resolve) => {
    const p = spawn('node', ['setup.mjs'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

const tests = [];
const test = (n, f) => tests.push([n, f]);

const baseEnv = (port) => ({
  CF_API_BASE: `http://127.0.0.1:${port}/cf`,
  TG_API_BASE: `http://127.0.0.1:${port}/tg`,
  GH_API_BASE: `http://127.0.0.1:${port}/gh`,
  WORKER_URL_OVERRIDE: `http://127.0.0.1:${port}/worker`,
  CF_API_TOKEN: 'cf-token-123',
  TELEGRAM_BOT_TOKEN: '111:AAA',
  OWNER_ID: '424242',
  BRAND_NAME: 'برند من',
  BRAVE_API_KEY: '',
  WORKER_NAME: 'my-ai-bot',
  WORKERS_SUBDOMAIN: 'mysub',
});

test('نصب کامل از GitHub (تلگرام در دسترس)', async () => {
  const m = await startMock();
  const { code, out } = await runSetup({ ...baseEnv(m.port), GITHUB_REPO: 'https://github.com/user/repo' });
  m.server.close();
  assert.equal(code, 0, out);
  assert.match(out, /آماده است/);
  assert.match(out, /https:\/\/my-ai-bot\.mysub\.workers\.dev/);
  assert.match(out, /@mybot_bot/);
  const up = m.log.uploads[0];
  assert.equal(up.name, 'my-ai-bot');
  assert.ok(up.hasCode);
  assert.equal(up.meta.main_module, 'index.js');
  const b = Object.fromEntries(up.meta.bindings.map((x) => [x.name, x]));
  assert.equal(b.AI.type, 'ai');
  assert.equal(b.DB.id, 'db-uuid-1');
  assert.equal(b.TELEGRAM_TOKEN.type, 'secret_text');
  assert.equal(b.TELEGRAM_TOKEN.text, '111:AAA');
  assert.equal(b.OWNER_ID.text, '424242');
  assert.equal(b.WORKER_URL.text, 'https://my-ai-bot.mysub.workers.dev');
  assert.match(b.WEBHOOK_SECRET.text, /^[A-Za-z0-9_-]{20,}$/);
  assert.ok(!b.BRAVE_API_KEY);
  assert.equal(m.log.boot, b.WEBHOOK_SECRET.text);
  assert.equal(m.log.queries.length, SCHEMA.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean).length);
  assert.deepEqual(m.log.cron, [{ cron: '* * * * *' }]);
  assert.ok(fs.existsSync(path.join(ROOT, 'deploy-info.json')));
  const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy-info.json'), 'utf8'));
  assert.ok(!JSON.stringify(info).includes('111:AAA') && !JSON.stringify(info).includes('cf-token'));
});

test('نصب با فایل‌های محلی + Brave key + تلگرام فیلتر (دسترسی ندارد)', async () => {
  const m = await startMock({ tgOk: false });
  const { code, out } = await runSetup({ ...baseEnv(m.port), GITHUB_REPO: '', BRAVE_API_KEY: 'brave-xyz' });
  m.server.close();
  assert.equal(code, 0, out);
  assert.match(out, /از این شبکه به تلگرام دسترسی نیست/);
  assert.match(out, /وب‌هوک از سمت Cloudflare ثبت شد/);
  assert.match(out, /@mybot_bot/); // از پاسخ /boot
  const b = Object.fromEntries(m.log.uploads[0].meta.bindings.map((x) => [x.name, x]));
  assert.equal(b.BRAVE_API_KEY.text, 'brave-xyz');
  assert.ok(!b.BOT_USERNAME);
});

test('توکن بدون دسترسی D1 → خطای مشخص', async () => {
  const m = await startMock();
  m.server.removeAllListeners('request');
  m.server.on('request', (req, res) => {
    res.setHeader('content-type', 'application/json');
    const u = new URL(req.url, 'http://x').pathname;
    if (u === '/cf/accounts') return res.end(JSON.stringify({ success: true, result: [{ id: 'acc1', name: 'T' }] }));
    if (u.endsWith('/workers/scripts')) return res.end(JSON.stringify({ success: true, result: [] }));
    res.statusCode = 403;
    res.end(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }));
  });
  const { code, out } = await runSetup({ ...baseEnv(m.port), GITHUB_REPO: '' });
  m.server.close();
  assert.equal(code, 1);
  assert.match(out, /Account › D1 › Edit/);
  assert.ok(!/Workers Scripts › Edit\n/.test(out.split('این دسترسی‌ها در توکن شما نیست')[1] || ''));
});

test('مخزن اشتباه → خطا', async () => {
  const m = await startMock();
  const { code, out } = await runSetup({ ...baseEnv(m.port), GITHUB_REPO: 'https://github.com/nobody/nothing', GITHUB_TOKEN: 'x' });
  m.server.close();
  assert.equal(code, 1);
  assert.match(out, /GitHub 404|خوانده نشد/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log('  ✔', name);
  } catch (e) {
    failed++;
    console.log('  ✖', name, '\n     ', String(e.stack || e).split('\n').slice(0, 90).join('\n      '));
  }
}
try {
  fs.unlinkSync(path.join(ROOT, 'deploy-info.json'));
} catch (_) {}
console.log(`\n${tests.length - failed}/${tests.length} تست موفق`);
process.exit(failed ? 1 : 0);
