#!/usr/bin/env node
// ============================================================================
//  نصب‌کننده‌ی تعاملی — ربات هوش مصنوعی روی Cloudflare Workers
//  اجرا:  node setup.mjs
//  بدون نیاز به نصب هیچ پکیج (فقط Node.js 18 یا بالاتر)
// ============================================================================
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CF_BASE = process.env.CF_API_BASE || 'https://api.cloudflare.com/client/v4';
const TG_BASE = process.env.TG_API_BASE || 'https://api.telegram.org';
const GH_BASE = process.env.GH_API_BASE || 'https://api.github.com';
const COMPAT_DATE = '2025-06-01';
const CRON = '* * * * *';

const c = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };
const say = (s = '') => console.log(s);
const ok = (s) => say(c.g('✔ ') + s);
const warn = (s) => say(c.y('⚠ ') + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error('Node.js 18 یا بالاتر لازم است.');
  process.exit(1);
}

const rl = readline.createInterface({ input, output });
async function ask(label, { def = '', env = '', required = true } = {}) {
  if (env && process.env[env] !== undefined && (process.env[env].trim() || !required)) {
    say(`${label} ${c.d('(از متغیر محیطی ' + env + ')')}`);
    return process.env[env].trim();
  }
  for (;;) {
    const a = (await rl.question(`${label}${def ? c.d(` [${def}]`) : ''}: `)).trim();
    if (a) return a;
    if (def) return def;
    if (!required) return '';
    say(c.r('  مقدار لازم است.'));
  }
}

// ---------------------------------------------------------------- Cloudflare
async function cf(token, method, p, body) {
  const r = await fetch(CF_BASE + p, {
    method,
    headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  let j;
  try {
    j = await r.json();
  } catch (_) {
    j = { success: false, errors: [{ message: 'HTTP ' + r.status }] };
  }
  if (!j.success) {
    const e = new Error((j.errors || []).map((x) => `${x.code || ''} ${x.message}`.trim()).join('; ') || 'HTTP ' + r.status);
    e.status = r.status;
    e.errors = j.errors || [];
    throw e;
  }
  return j.result;
}

// ------------------------------------------------------------------ Telegram
async function tgApi(token, method, body, timeoutMs = 9000) {
  try {
    const r = await fetch(`${TG_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await r.json();
  } catch (_) {
    return null; // شبکه در دسترس نیست
  }
}

// -------------------------------------------------------------------- GitHub
function parseRepo(u) {
  const m = u.trim().match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^\s?#]+))?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref: m[3] || '' };
}
async function ghFile({ owner, repo, ref }, file, ghToken) {
  const r = await fetch(`${GH_BASE}/repos/${owner}/${repo}/contents/${file}${ref ? '?ref=' + encodeURIComponent(ref) : ''}`, {
    headers: { accept: 'application/vnd.github.raw+json', 'user-agent': 'ai-bot-setup', ...(ghToken ? { authorization: 'Bearer ' + ghToken } : {}) },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const e = new Error(`GitHub ${r.status} (${file})`);
    e.status = r.status;
    throw e;
  }
  return await r.text();
}

// ===========================================================================
async function main() {
  say();
  say(c.b('🤖  نصب ربات هوش مصنوعی روی Cloudflare'));
  say(c.d('──────────────────────────────────────────'));
  say();

  // ---------------------------------------------------------------- ۱) توکن
  say(c.b('مرحله ۱ — توکن Cloudflare'));
  say('وارد https://dash.cloudflare.com/profile/api-tokens شوید →');
  say('Create Token → Create Custom Token  و این دسترسی‌ها را بدهید:');
  say('  ' + c.y('Account › Workers Scripts › Edit'));
  say('  ' + c.y('Account › D1 › Edit'));
  say('  ' + c.y('Account › Account Settings › Read'));
  say('  Account Resources: Include › حساب خودتان   (Zone لازم نیست)');
  say(c.d('  (نیازی به دسترسی جدا برای Workers AI نیست؛ از طریق خود Worker کار می‌کند)'));
  say();
  const token = await ask('توکن Cloudflare را وارد کنید', { env: 'CF_API_TOKEN' });

  let accounts;
  try {
    accounts = await cf(token, 'GET', '/accounts?per_page=50');
  } catch (e) {
    say(c.r('✖ توکن نامعتبر است یا دسترسی «Account Settings › Read» ندارد: ' + e.message));
    process.exit(1);
  }
  if (!accounts.length) {
    say(c.r('✖ هیچ حسابی برای این توکن پیدا نشد (Account Resources را بررسی کنید).'));
    process.exit(1);
  }
  let account = accounts[0];
  if (accounts.length > 1) {
    accounts.forEach((a, i) => say(`  ${i + 1}) ${a.name}`));
    const n = Number(await ask('کدام حساب؟ شماره', { def: '1' }));
    account = accounts[(n || 1) - 1] || accounts[0];
  }
  const acc = account.id;
  ok(`حساب: ${account.name}`);

  // بررسی دسترسی‌ها
  const missing = [];
  let scripts = [];
  try {
    scripts = await cf(token, 'GET', `/accounts/${acc}/workers/scripts`);
  } catch (_) {
    missing.push('Account › Workers Scripts › Edit');
  }
  try {
    await cf(token, 'GET', `/accounts/${acc}/d1/database?per_page=5`);
  } catch (_) {
    missing.push('Account › D1 › Edit');
  }
  if (missing.length) {
    say(c.r('✖ این دسترسی‌ها در توکن شما نیست:'));
    missing.forEach((m) => say('   • ' + m));
    say('توکن را اصلاح کنید (یا توکن جدید بسازید) و دوباره اجرا کنید.');
    process.exit(1);
  }
  ok('دسترسی‌های توکن کامل است');
  say();

  // --------------------------------------------------------------- ۲) گیت‌هاب
  say(c.b('مرحله ۲ — کد پروژه'));
  say('لینک مخزن GitHub را بدهید تا کد از همان‌جا گرفته شود؛');
  say(c.d('اگر خالی بگذارید از فایل‌های همین پوشه استفاده می‌شود.'));
  const repoUrl = await ask('لینک GitHub (مثل https://github.com/user/repo)', { env: 'GITHUB_REPO', required: false });
  let code;
  let eitaaCode;
  let schema;
  let source;
  if (repoUrl) {
    const repo = parseRepo(repoUrl);
    if (!repo) {
      say(c.r('✖ لینک GitHub معتبر نیست.'));
      process.exit(1);
    }
    let ghToken = process.env.GITHUB_TOKEN || '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        code = await ghFile(repo, 'src/index.js', ghToken);
        schema = await ghFile(repo, 'schema.sql', ghToken);
        eitaaCode = await ghFile(repo, 'src/eitaa.js', ghToken);
        break;
      } catch (e) {
        if ((e.status === 404 || e.status === 401 || e.status === 403) && !ghToken) {
          warn('مخزن پیدا نشد؛ اگر خصوصی (private) است یک GitHub token با دسترسی خواندن Contents وارد کنید.');
          ghToken = await ask('GitHub token (خالی = انصراف)', { required: false });
          if (!ghToken) break;
        } else {
          say(c.r('✖ ' + e.message));
          break;
        }
      }
    }
    if (!code || !schema || !eitaaCode) {
      say(c.r('✖ فایل‌های src/index.js و src/eitaa.js و schema.sql از مخزن خوانده نشد. مطمئن شوید آپلود شده‌اند.'));
      process.exit(1);
    }
    source = `${repo.owner}/${repo.repo}`;
  } else {
    code = fs.readFileSync(path.join(HERE, 'src/index.js'), 'utf8');
    schema = fs.readFileSync(path.join(HERE, 'schema.sql'), 'utf8');
    eitaaCode = fs.readFileSync(path.join(HERE, 'src/eitaa.js'), 'utf8');
    source = 'local';
  }
  if (!/export default/.test(code) || !/CREATE TABLE/i.test(schema) || !/export \{/.test(eitaaCode)) {
    say(c.r('✖ محتوای فایل‌ها معتبر به نظر نمی‌رسد.'));
    process.exit(1);
  }
  const sha = crypto.createHash('sha256').update(code + eitaaCode).digest('hex').slice(0, 12);
  ok(`کد دریافت شد (${source}, ${Math.round(code.length / 1024)}KB, sha256:${sha})`);
  say();

  // --------------------------------------------------------------- ۳) تلگرام
  say(c.b('مرحله ۳ — ربات تلگرام'));
  say('از @BotFather در تلگرام یک ربات بسازید (/newbot) و توکنش را بدهید.');
  const tgToken = await ask('توکن ربات تلگرام', { env: 'TELEGRAM_BOT_TOKEN' });
  let botName = '';
  let botUser = '';
  let tgDirect = false;
  const me = await tgApi(tgToken, 'getMe');
  if (me && me.ok) {
    tgDirect = true;
    botUser = me.result.username;
    botName = me.result.first_name;
    ok(`ربات پیدا شد: @${botUser}`);
  } else if (me && !me.ok && (me.error_code === 401 || me.error_code === 404)) {
    say(c.r('✖ توکن تلگرام نامعتبر است: ' + (me.description || '')));
    process.exit(1);
  } else {
    warn('از این شبکه به تلگرام دسترسی نیست (فیلتر/بدون VPN). مشکلی نیست؛ ثبت وب‌هوک از سمت Cloudflare انجام می‌شود.');
    warn('فقط مطمئن شوید توکن را درست وارد کرده‌اید.');
  }

  let ownerId = process.env.OWNER_ID || '';
  if (!ownerId) {
    say();
    say('شناسه‌ی عددی تلگرام شما (مالک ربات). دو راه:');
    say('  • عدد را مستقیم بنویسید (از @userinfobot بگیرید)، یا');
    say('  • Enter بزنید و همین الان به رباتتان یک پیام بفرستید تا خودکار پیدا شود.');
    ownerId = await ask('شناسه‌ی عددی مالک', { required: false });
  }
  if (!ownerId) {
    if (!tgDirect) {
      say(c.r('✖ بدون دسترسی به تلگرام امکان تشخیص خودکار نیست؛ عدد را وارد کنید.'));
      process.exit(1);
    }
    await tgApi(tgToken, 'deleteWebhook', { drop_pending_updates: false });
    say(`⏳ در تلگرام به @${botUser} هر پیامی بفرستید (تا ۹۰ ثانیه صبر می‌کنم)…`);
    const t0 = Date.now();
    while (!ownerId && Date.now() - t0 < 90000) {
      const u = await tgApi(tgToken, 'getUpdates', { timeout: 10, allowed_updates: ['message'] }, 20000);
      const m = u && u.ok && u.result.find((x) => x.message && x.message.from && !x.message.from.is_bot);
      if (m) ownerId = String(m.message.from.id);
      else await sleep(500);
    }
    if (!ownerId) {
      say(c.r('✖ پیامی دریافت نشد. دوباره اجرا کنید یا شناسه را دستی وارد کنید.'));
      process.exit(1);
    }
  }
  if (!/^\d+(,\d+)*$/.test(ownerId)) {
    say(c.r('✖ شناسه باید فقط عدد باشد (چند مالک: با کاما جدا کنید).'));
    process.exit(1);
  }
  ok(`مالک: ${ownerId}`);

  const brand = await ask('نام برند/ربات (در سایت و پاسخ‌ها)', { def: botName || 'دستیار هوشمند', env: 'BRAND_NAME' });
  say(c.d('جستجوی وب پیش‌فرض بدون کلید کار می‌کند. اگر کلید Brave Search دارید (اختیاری، برای پایداری بیشتر) وارد کنید.'));
  const brave = await ask('Brave Search API key (اختیاری)', { required: false, env: 'BRAVE_API_KEY' });
  const defName = 'ai-bot-' + (botUser || 'bot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const workerName = (await ask('نام Worker', { def: defName, env: 'WORKER_NAME' })).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  say();

  // ------------------------------------------------------------ ۴) ساخت روی CF
  say(c.b('مرحله ۴ — ساخت و استقرار'));
  const exists = scripts.some((s) => s.id === workerName);
  if (exists) warn(`Worker «${workerName}» از قبل هست؛ به‌روزرسانی می‌شود (داده‌های دیتابیس حفظ می‌شود).`);

  // دیتابیس
  const dbName = workerName + '-db';
  let db = (await cf(token, 'GET', `/accounts/${acc}/d1/database?name=${encodeURIComponent(dbName)}`)).find((d) => d.name === dbName);
  if (!db) {
    db = await cf(token, 'POST', `/accounts/${acc}/d1/database`, { name: dbName });
    ok(`دیتابیس ساخته شد (${dbName})`);
  } else ok(`دیتابیس موجود استفاده شد (${dbName})`);
  const dbId = db.uuid || db.id;
  const stmts = schema.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
  for (const s of stmts) await cf(token, 'POST', `/accounts/${acc}/d1/database/${dbId}/query`, { sql: s });
  ok(`جدول‌ها آماده شد (${stmts.length} دستور)`);

  // ساب‌دامین workers.dev
  let sub = '';
  try {
    sub = (await cf(token, 'GET', `/accounts/${acc}/workers/subdomain`)).subdomain || '';
  } catch (_) {}
  if (!sub) {
    say('هنوز زیردامنه‌ی workers.dev ندارید؛ یک نام انتخاب کنید (آدرس: نام.workers.dev).');
    for (;;) {
      const want = (await ask('نام زیردامنه (حروف انگلیسی/عدد/خط تیره)', { def: workerName.slice(0, 30), env: 'WORKERS_SUBDOMAIN' })).toLowerCase();
      try {
        sub = (await cf(token, 'PUT', `/accounts/${acc}/workers/subdomain`, { subdomain: want })).subdomain || want;
        break;
      } catch (e) {
        say(c.r('  نشد: ' + e.message + ' — نام دیگری امتحان کنید.'));
        if (process.env.WORKERS_SUBDOMAIN) process.exit(1);
      }
    }
  }
  const siteUrl = `https://${workerName}.${sub}.workers.dev`;
  const bootBase = process.env.WORKER_URL_OVERRIDE || siteUrl;

  const webhookSecret = crypto.randomBytes(24).toString('base64url');
  const bindings = [
    { type: 'ai', name: 'AI' },
    { type: 'd1', name: 'DB', id: dbId },
    { type: 'secret_text', name: 'TELEGRAM_TOKEN', text: tgToken },
    { type: 'secret_text', name: 'WEBHOOK_SECRET', text: webhookSecret },
    { type: 'plain_text', name: 'OWNER_ID', text: ownerId },
    { type: 'plain_text', name: 'BRAND_NAME', text: brand },
    { type: 'plain_text', name: 'WORKER_URL', text: siteUrl },
  ];
  if (botUser) bindings.push({ type: 'plain_text', name: 'BOT_USERNAME', text: botUser });
  if (brave) bindings.push({ type: 'secret_text', name: 'BRAVE_API_KEY', text: brave });

  async function upload(withObs) {
    const meta = { main_module: 'index.js', compatibility_date: COMPAT_DATE, bindings, ...(withObs ? { observability: { enabled: true } } : {}) };
    const fd = new FormData();
    fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    fd.append('index.js', new Blob([code], { type: 'application/javascript+module' }), 'index.js');
    fd.append('eitaa.js', new Blob([eitaaCode], { type: 'application/javascript+module' }), 'eitaa.js');
    const r = await fetch(`${CF_BASE}/accounts/${acc}/workers/scripts/${workerName}`, {
      method: 'PUT',
      headers: { authorization: 'Bearer ' + token },
      body: fd,
      signal: AbortSignal.timeout(120000),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.success) throw new Error((j.errors || []).map((x) => `${x.code} ${x.message}`).join('; ') || 'HTTP ' + r.status);
  }
  try {
    await upload(true);
  } catch (e1) {
    try {
      await upload(false);
    } catch (e2) {
      say(c.r('✖ آپلود Worker ناموفق بود: ' + e2.message));
      process.exit(1);
    }
  }
  ok('Worker آپلود شد');

  await cf(token, 'POST', `/accounts/${acc}/workers/scripts/${workerName}/subdomain`, { enabled: true, previews_enabled: false }).catch((e) =>
    warn('فعال‌سازی workers.dev: ' + e.message)
  );
  await cf(token, 'PUT', `/accounts/${acc}/workers/scripts/${workerName}/schedules`, [{ cron: CRON }]).then(
    () => ok('بررسی خودکار وب‌هوک (Cron) فعال شد'),
    (e) => warn('Cron: ' + e.message)
  );

  // ------------------------------------------------------------- ۵) وب‌هوک
  say();
  say(c.b('مرحله ۵ — اتصال تلگرام'));
  let boot = null;
  for (let i = 0; i < 12 && !(boot && boot.ok); i++) {
    try {
      const r = await fetch(`${bootBase}/boot?k=${encodeURIComponent(webhookSecret)}`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) boot = await r.json();
    } catch (_) {}
    if (!(boot && boot.ok)) {
      if (i === 0) say(c.d('  منتظر آماده‌شدن آدرس workers.dev …'));
      await sleep(4000);
    }
  }
  if (boot && boot.ok) {
    botUser = boot.bot || botUser;
    ok('وب‌هوک از سمت Cloudflare ثبت شد');
  } else if (tgDirect) {
    const w = await tgApi(tgToken, 'setWebhook', {
      url: `${siteUrl}/telegram`,
      secret_token: webhookSecret,
      allowed_updates: ['message', 'callback_query'],
      max_connections: 40,
    });
    if (w && w.ok) ok('وب‌هوک مستقیماً ثبت شد');
    else warn('ثبت مستقیم وب‌هوک نشد؛ Cron ظرف چند دقیقه خودش انجام می‌دهد.');
  } else {
    say('⏳ آدرس سایت از شبکه‌ی شما در دسترس نیست؛ منتظر ثبت وب‌هوک توسط Cloudflare (حداکثر ۴ دقیقه)…');
    for (let i = 0; i < 24; i++) {
      await sleep(10000);
      try {
        const q = await cf(token, 'POST', `/accounts/${acc}/d1/database/${dbId}/query`, {
          sql: "SELECT key,value FROM settings WHERE key IN ('bot_username','webhook_ok','webhook_error')",
        });
        const rows = Object.fromEntries(((q[0] && q[0].results) || []).map((r) => [r.key, r.value]));
        if (rows.bot_username) botUser = rows.bot_username;
        if (rows.webhook_ok) {
          ok('وب‌هوک ثبت شد');
          break;
        }
        if (rows.webhook_error) process.stdout.write(c.d(`  (${rows.webhook_error}) `));
      } catch (_) {}
    }
  }

  fs.writeFileSync(
    path.join(HERE, 'deploy-info.json'),
    JSON.stringify({ worker: workerName, url: siteUrl, bot: botUser || null, account: acc, d1: { name: dbName, id: dbId }, at: new Date().toISOString() }, null, 2)
  );

  say();
  say(c.g('════════════════════════════════════════'));
  say(c.g(c.b('✅ آماده است!')));
  say(`🌐 سایت:        ${c.b(siteUrl)}`);
  say(`🤖 ربات:        ${c.b(botUser ? '@' + botUser : '(نام کاربری هنوز مشخص نشده)')}${botUser ? '   https://t.me/' + botUser : ''}`);
  say(`🔐 پنل مدیریت:  در ربات دستور ${c.b('/panel')} را بفرستید (فقط مالک)`);
  say(`🩺 تست سلامت:   در ربات دستور ${c.b('/diag')} را بفرستید`);
  say(c.g('════════════════════════════════════════'));
  say();
  say(c.d('اگر آدرس workers.dev از اینترنت ایران باز نمی‌شود، با VPN امتحان کنید یا بعداً دامنه‌ی اختصاصی وصل کنید؛ ربات تلگرام به آن وابسته نیست.'));
  rl.close();
}

main().catch((e) => {
  console.error(c.r('\n✖ خطا: ' + (e && e.message ? e.message : e)));
  rl.close();
  process.exit(1);
});
