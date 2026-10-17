// تست محلی ورکر با D1 شبیه‌سازی‌شده (SQLite) و Workers AI / Telegram شبیه‌سازی‌شده
// اجرا: node test/worker.test.mjs   (Node 22+)
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../src/index.js';

// ---------- D1 mock ----------
function makeD1() {
  const db = new DatabaseSync(':memory:');
  const wrap = (sql, params = []) => ({
    bind: (...p) => wrap(sql, p),
    run: async () => {
      const r = db.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(r.changes) } };
    },
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params).map((r) => ({ ...r })), success: true }),
  });
  return {
    prepare: (s) => wrap(s),
    batch: async (stmts) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    raw: db,
  };
}

// ---------- fixtures ----------
const DDG_HTML = `<div class="result results_links"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle1&amp;rut=abc">Dollar price <b>today</b></a></h2><a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle1&amp;rut=abc">The dollar is at <b>100</b> today.</a></div>
<div class="result"><a class="result__a" href="https://duckduckgo.com/y.js?ad_provider=x">ad</a></div>`;
const BING_HTML = `<ol><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=xyz&amp;u=a1aHR0cHM6Ly9leGFtcGxlLm9yZy9wYWdl&amp;ntb=1">Example Page</a></h2><div class="b_caption"><p>Snippet text here</p></div></li></ol>`;
const PAGE_HTML = `<html><head><title>My Article</title><style>.x{}</style></head><body><nav>menu</nav><article><h1>Heading</h1><p>${'Hello world. '.repeat(120)}</p><script>var x=1</script></article><footer>foot</footer></body></html>`;
const TINY_JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]).toString('base64');

// ---------- global mocks ----------
let tgCalls = [];
let ddgMode = 'ok'; // ok | empty
const eitaaCalls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://api.telegram.org/file/')) return new Response(new Uint8Array([1, 2, 3, 4, 5, 6]));
  if (url.startsWith('https://api.telegram.org/bot')) {
    const method = url.split('/').pop();
    let payload = {};
    if (typeof init.body === 'string') payload = JSON.parse(init.body);
    else if (init.body instanceof FormData) payload = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, v instanceof Blob ? `<blob ${v.size}>` : v]));
    tgCalls.push({ method, payload });
    if (method === 'getFile') return Response.json({ ok: true, result: { file_path: 'photos/file_1.jpg', file_size: 1000 } });
    if (method === 'getMe') return Response.json({ ok: true, result: { username: 'testbot', first_name: 'Test' } });
    if (method === 'getWebhookInfo') return Response.json({ ok: true, result: { url: '' } });
    return Response.json({ ok: true, result: { message_id: 1 } });
  }
  if (url.startsWith('https://eitaayar.ir/api/bot')) {
    const method = url.split('/').pop();
    let form = {};
    if (init.body instanceof FormData) form = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, v instanceof Blob ? '<blob>' : v]));
    eitaaCalls.push({ method, form });
    if (method === 'getMe') return Response.json({ ok: true, result: { username: 'acc_eitaa' } });
    return Response.json({ ok: true, result: { message_id: 77 } });
  }
  if (url.startsWith('https://eitaa.com')) return new Response('busy', { status: 503 });
  if (url.startsWith('https://html.duckduckgo.com')) return new Response(ddgMode === 'ok' ? DDG_HTML : '<html>anomaly</html>');
  if (url.startsWith('https://www.bing.com/search')) return new Response(BING_HTML);
  if (url.startsWith('https://example.com/article1')) return new Response(PAGE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  return new Response('not mocked: ' + url, { status: 404 });
};

const aiCalls = [];
const aiQueue = [];
const env = {
  DB: makeD1(),
  TELEGRAM_TOKEN: '123:abc',
  WEBHOOK_SECRET: 'sec',
  OWNER_ID: '1000',
  BRAND_NAME: 'تست‌بات',
  WORKER_URL: 'https://w.example.workers.dev',
  AI: {
    run: async (model, input) => {
      aiCalls.push({ model, input });
      const next = aiQueue.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next(model, input);
      if (next !== undefined) return next;
      // پیش‌فرض هوشمند
      if (model.includes('flux')) return { image: TINY_JPEG_B64 };
      if (model.includes('whisper')) return { text: 'سلام این یک پیام صوتی است' };
      const last = input.messages[input.messages.length - 1];
      const txt = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
      if (input.tools && /search tool/.test(txt)) return { choices: [{ message: { content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } }] } }] };
      if (/image_url/.test(txt) && /color/.test(txt)) return { choices: [{ message: { content: 'Red' } }] };
      return { choices: [{ message: { content: 'پاسخ پیش‌فرض' } }] };
    },
  },
};

let uid = 100;
const U = (id, name = 'Ali', username = 'ali') => ({ id, first_name: name, username });
async function send(part, from = U(2000), chat = null, updateId = null) {
  const update = { update_id: updateId ?? ++uid, message: { message_id: uid, from, chat: chat || { id: from.id, type: 'private' }, date: 0, ...part } };
  const res = await worker.fetch(new Request('https://w.example.workers.dev/telegram', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'sec', 'content-type': 'application/json' }, body: JSON.stringify(update) }), env);
  return { res, update };
}
const sent = (chatId) => tgCalls.filter((c) => c.method === 'sendMessage' && (chatId == null || c.payload.chat_id === chatId));
const reset = () => {
  tgCalls = [];
  aiCalls.length = 0;
  aiQueue.length = 0;
  ddgMode = 'ok';
};
const dbq = (sql, ...p) => env.DB.raw.prepare(sql).all(...p);

// ---------- runner ----------
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('schema.sql مطابق SCHEMA داخل کد است', async () => {
  const sql = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  const fresh = new DatabaseSync(':memory:');
  fresh.exec(sql);
  const t1 = fresh.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  await worker.fetch(new Request('https://w.example.workers.dev/health'), env);
  await send({ text: '/id' });
  const t2 = dbq("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name).filter((n) => !n.startsWith('sqlite_'));
  assert.deepEqual(t1.filter((n) => !n.startsWith('sqlite_')), t2);
});

test('webhook secret اشتباه رد می‌شود', async () => {
  const res = await worker.fetch(new Request('https://w.example.workers.dev/telegram', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'bad' }, body: '{}' }), env);
  assert.equal(res.status, 403);
});

test('/start پیام خوش‌آمد با نام برند', async () => {
  reset();
  await send({ text: '/start' });
  const m = sent(2000);
  assert.equal(m.length, 1);
  assert.match(m[0].payload.text, /تست‌بات/);
  assert.equal(aiCalls.length, 0);
});

test('گفتگوی عادی + جستجوی وب (tool loop) + HTML', async () => {
  reset();
  aiQueue.push({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"dollar price"}' } }] } }] });
  aiQueue.push({ choices: [{ message: { content: 'قیمت **۱۰۰** است. منبع: [مثال](https://example.com/article1)' } }] });
  await send({ text: 'قیمت دلار امروز چنده؟' });
  assert.equal(aiCalls.length, 2);
  const second = aiCalls[1].input.messages;
  const toolMsg = second.find((m) => m.role === 'tool');
  assert.ok(toolMsg, 'tool message فرستاده نشد');
  assert.match(toolMsg.content, /example\.com\/article1/);
  assert.match(toolMsg.content, /Dollar price today/);
  assert.ok(!/y\.js/.test(toolMsg.content), 'تبلیغ فیلتر نشد');
  const asst = second.find((m) => m.role === 'assistant' && m.tool_calls);
  assert.equal(asst.tool_calls[0].function.arguments, '{"query":"dollar price"}');
  const out = sent(2000).pop().payload;
  assert.equal(out.parse_mode, 'HTML');
  assert.match(out.text, /<b>۱۰۰<\/b>/);
  assert.match(out.text, /<a href="https:\/\/example.com\/article1">مثال<\/a>/);
  const rows = dbq("SELECT role FROM messages WHERE chat_id=2000 ORDER BY id");
  assert.deepEqual(rows.map((r) => r.role), ['user', 'assistant']);
});

test('حافظه گفتگو در پیام بعدی به مدل داده می‌شود', async () => {
  reset();
  await send({ text: 'ادامه بده' });
  const msgs = aiCalls[0].input.messages;
  assert.equal(msgs[0].role, 'system');
  assert.ok(msgs.some((m) => m.role === 'assistant' && /۱۰۰/.test(m.content)));
  assert.match(msgs[0].content, /Current date/);
});

test('dedupe: update_id تکراری دوباره پردازش نمی‌شود', async () => {
  reset();
  const first = await send({ text: 'سلام' }, U(2001, 'Reza', 'reza'));
  const n = sent(2001).length;
  assert.equal(n, 1);
  await send({ text: 'سلام' }, U(2001, 'Reza', 'reza'), null, first.update.update_id);
  assert.equal(sent(2001).length, 1);
});

test('عکس: به مدل به‌صورت image_url ارسال می‌شود', async () => {
  reset();
  await send({ photo: [{ file_id: 'a', width: 90, height: 90 }, { file_id: 'b', width: 800, height: 600 }, { file_id: 'c', width: 1280, height: 960 }], caption: 'این چیه؟' });
  const content = aiCalls[0].input.messages.at(-1).content;
  assert.ok(Array.isArray(content));
  assert.equal(content[0].text, 'این چیه؟');
  assert.match(content[1].image_url.url, /^data:image\/jpeg;base64,/);
  const getFile = tgCalls.find((c) => c.method === 'getFile');
  assert.equal(getFile.payload.file_id, 'b'); // بزرگ‌ترین ≤۱۱۰۰
  const saved = dbq("SELECT content FROM messages WHERE role='user' ORDER BY id DESC LIMIT 1")[0].content;
  assert.ok(!/base64/.test(saved));
});

test('ساخت تصویر با tool (فرمت قدیمی tool_calls) + sendPhoto + سهمیه', async () => {
  reset();
  aiQueue.push({ response: '', tool_calls: [{ name: 'generate_image', arguments: { prompt: 'a cat astronaut on the moon, cinematic' } }] });
  aiQueue.push(() => ({ image: TINY_JPEG_B64 })); // خروجی flux
  aiQueue.push({ response: 'تصویر آماده شد 🎨' });
  await send({ text: '/image گربه فضانورد' });
  assert.equal(aiCalls[1].model.includes('flux'), true);
  const photo = tgCalls.find((c) => c.method === 'sendPhoto');
  assert.ok(photo, 'sendPhoto صدا زده نشد');
  assert.match(photo.payload.photo, /<blob \d+>/);
  assert.equal(dbq('SELECT imgs_today FROM users WHERE id=2000')[0].imgs_today, 1);
  const note = dbq("SELECT content FROM messages WHERE role='assistant' ORDER BY id DESC LIMIT 1")[0].content;
  assert.match(note, /a cat astronaut/);
});

test('سهمیه‌ی تصویر: وقتی تمام شده به مدل QUOTA برمی‌گردد', async () => {
  reset();
  env.DB.raw.prepare("UPDATE users SET imgs_today=3 WHERE id=2000").run();
  aiQueue.push({ choices: [{ message: { content: '', tool_calls: [{ id: 'g', type: 'function', function: { name: 'generate_image', arguments: '{"prompt":"x"}' } }] } }] });
  aiQueue.push({ choices: [{ message: { content: 'سهمیه تمام شده' } }] });
  await send({ text: 'یه عکس بکش' });
  assert.ok(!tgCalls.some((c) => c.method === 'sendPhoto'));
  const tool = aiCalls[1].input.messages.find((m) => m.role === 'tool');
  assert.match(tool.content, /^QUOTA/);
});

test('سهمیه‌ی پیام روزانه', async () => {
  reset();
  env.DB.raw.prepare("INSERT INTO settings(key,value) VALUES('limits', ?1) ON CONFLICT(key) DO UPDATE SET value=?1").run(JSON.stringify({ free: { label: 'رایگان', msgs: 1, images: 1 } }));
  await send({ text: 'یک' }, U(3000, 'Q', 'q'));
  await send({ text: 'دو' }, U(3000, 'Q', 'q'));
  const m = sent(3000);
  assert.equal(m.length, 2);
  assert.match(m[1].payload.text, /سهمیه پیام امروز/);
  assert.equal(aiCalls.length, 1);
  env.DB.raw.prepare("DELETE FROM settings WHERE key='limits'").run();
});

test('/grant پلن + اعلان به کاربر + محدودیت‌ها', async () => {
  reset();
  await send({ text: '/grant 3000 pro 30' }, U(1000, 'Owner', 'owner'));
  const row = dbq('SELECT plan, plan_until FROM users WHERE id=3000')[0];
  assert.equal(row.plan, 'pro');
  assert.ok(row.plan_until > Date.now() / 1000);
  assert.ok(sent(3000).some((c) => /فعال شد/.test(c.payload.text)));
  await send({ text: 'پیام دوباره' }, U(3000, 'Q', 'q'));
  assert.ok(aiCalls.length >= 1); // حالا اجازه دارد
});

test('دستورات مالک برای کاربر عادی کار نمی‌کند', async () => {
  reset();
  await send({ text: '/grant 2000 vip 30' }, U(2000));
  assert.notEqual(dbq('SELECT plan FROM users WHERE id=2000')[0].plan, 'vip');
});

test('کاربر مسدود نادیده گرفته می‌شود', async () => {
  reset();
  await send({ text: '/ban 2001' }, U(1000, 'Owner', 'owner'));
  tgCalls = [];
  await send({ text: 'هی' }, U(2001, 'Reza', 'reza'));
  assert.equal(sent(2001).length, 0);
  await send({ text: '/unban 2001' }, U(1000, 'Owner', 'owner'));
});

test('خطای سهمیه‌ی Workers AI → پیام مناسب + اطلاع به مالک (یک بار)', async () => {
  reset();
  aiQueue.push(new Error('4006: you have used up your daily free allocation of 10,000 neurons'));
  await send({ text: 'سلام' }, U(2002, 'Sara', 'sara'));
  assert.match(sent(2002).pop().payload.text, /ظرفیت هوش مصنوعی/);
  assert.equal(sent(1000).filter((c) => /سهمیه رایگان/.test(c.payload.text)).length, 1);
  aiQueue.push(new Error('4006: you have used up your daily free allocation'));
  await send({ text: 'باز هم' }, U(2002, 'Sara', 'sara'));
  assert.equal(sent(1000).filter((c) => /سهمیه رایگان/.test(c.payload.text)).length, 1);
});

test('خطای مدل اصلی → فالبک بدون ابزار', async () => {
  reset();
  aiQueue.push(new Error('schema validation: tools not supported'));
  aiQueue.push({ choices: [{ message: { content: 'جواب بدون ابزار' } }] });
  await send({ text: 'تست فالبک' }, U(2003, 'Nima', 'nima'));
  assert.equal(aiCalls.length, 2);
  assert.ok(aiCalls[0].input.tools && !aiCalls[1].input.tools);
  assert.match(sent(2003).pop().payload.text, /جواب بدون ابزار/);
});

test('خطای مدل برای عکس → فالبک بینایی (Llama 4 Scout)', async () => {
  reset();
  aiQueue.push(new Error('bad image format'));
  aiQueue.push({ choices: [{ message: { content: 'از مدل دوم' } }] });
  await send({ photo: [{ file_id: 'p', width: 800, height: 600 }], caption: 'چیه' }, U(2004, 'Z', 'z'));
  assert.match(aiCalls[1].model, /llama-4-scout/);
  assert.match(sent(2004).pop().payload.text, /از مدل دوم/);
});

test('پیام صوتی → Whisper → متن', async () => {
  reset();
  await send({ voice: { file_id: 'v', duration: 3, file_size: 1000 } }, U(2005, 'V', 'v'));
  assert.ok(aiCalls[0].model.includes('whisper'));
  assert.match(JSON.stringify(aiCalls[1].input.messages.at(-1)), /پیام صوتی/);
});

test('ابزار remember و /memory و /forget', async () => {
  reset();
  aiQueue.push({ choices: [{ message: { content: '', tool_calls: [{ id: 'r', type: 'function', function: { name: 'remember', arguments: '{"fact":"نام کاربر علی است"}' } }] } }] });
  aiQueue.push({ choices: [{ message: { content: 'باشه' } }] });
  await send({ text: 'من علی هستم' }, U(2006, 'Ali', 'ali6'));
  assert.equal(dbq('SELECT fact FROM facts WHERE user_id=2006').length, 1);
  await send({ text: '/memory' }, U(2006, 'Ali', 'ali6'));
  assert.match(sent(2006).pop().payload.text, /نام کاربر علی است/);
  await send({ text: 'سوال بعدی' }, U(2006, 'Ali', 'ali6'));
  assert.match(aiCalls.at(-1).input.messages[0].content, /نام کاربر علی است/);
  await send({ text: '/forget' }, U(2006, 'Ali', 'ali6'));
  assert.equal(dbq('SELECT * FROM facts WHERE user_id=2006').length, 0);
  assert.equal(dbq('SELECT * FROM messages WHERE chat_id=2006').length, 0);
});

test('خلاصه‌سازی حافظه وقتی تاریخچه طولانی شود', async () => {
  reset();
  const ins = env.DB.raw.prepare('INSERT INTO messages(chat_id,role,content,ts) VALUES(?1,?2,?3,0)');
  for (let i = 0; i < 44; i++) ins.run(2007, i % 2 ? 'assistant' : 'user', 'پیام شماره ' + i);
  aiQueue.push({ choices: [{ message: { content: 'جواب' } }] });
  aiQueue.push({ choices: [{ message: { content: 'خلاصه: کاربر درباره‌ی اعداد حرف زد' } }] });
  await send({ text: 'آخرین' }, U(2007, 'S', 's7'));
  const s = dbq('SELECT summary FROM summaries WHERE chat_id=2007')[0];
  assert.match(s.summary, /خلاصه/);
  assert.ok(dbq('SELECT COUNT(*) c FROM messages WHERE chat_id=2007')[0].c <= 20);
  reset();
  await send({ text: 'بعدی' }, U(2007, 'S', 's7'));
  assert.match(aiCalls[0].input.messages[0].content, /خلاصه: کاربر/);
});

test('گروه: بدون منشن نادیده، با منشن پاسخ با reply', async () => {
  reset();
  env.DB.raw.prepare("INSERT INTO settings(key,value) VALUES('bot_username','testbot') ON CONFLICT(key) DO UPDATE SET value='testbot'").run();
  const g = { id: -500, type: 'supergroup' };
  await send({ text: 'سلام بچه‌ها' }, U(2008, 'G', 'g8'), g);
  assert.equal(sent(-500).length, 0);
  await send({ text: '@testbot قیمت چیه؟' }, U(2008, 'G', 'g8'), g);
  const m = sent(-500);
  assert.equal(m.length, 1);
  assert.ok(m[0].payload.reply_parameters);
  assert.match(aiCalls[0].input.messages.at(-1).content, /^\[G\]: قیمت چیه؟/);
});

test('فایل متنی به عنوان ورودی', async () => {
  reset();
  await send({ document: { file_id: 'd', file_name: 'a.py', mime_type: 'text/x-python', file_size: 100 }, caption: 'بررسی کن' }, U(2009, 'D', 'd9'));
  assert.match(aiCalls[0].input.messages.at(-1).content, /فایل ضمیمه: a\.py/);
});

test('جستجو: DDG خالی → Bing (دیکد لینک ردیابی) ', async () => {
  reset();
  ddgMode = 'empty';
  aiQueue.push({ choices: [{ message: { content: '', tool_calls: [{ id: 's', type: 'function', function: { name: 'web_search', arguments: '{"query":"q"}' } }] } }] });
  aiQueue.push({ choices: [{ message: { content: 'ok' } }] });
  await send({ text: 'جستجو کن' }, U(2010, 'B', 'b10'));
  const tool = aiCalls[1].input.messages.find((m) => m.role === 'tool').content;
  assert.match(tool, /via bing/);
  assert.match(tool, /https:\/\/example\.org\/page/);
});

test('read_webpage: متن مقاله استخراج می‌شود', async () => {
  reset();
  aiQueue.push({ choices: [{ message: { content: '', tool_calls: [{ id: 'p', type: 'function', function: { name: 'read_webpage', arguments: '{"url":"https://example.com/article1"}' } }] } }] });
  aiQueue.push({ choices: [{ message: { content: 'ok' } }] });
  await send({ text: 'این لینک رو بخون' }, U(2011, 'R', 'r11'));
  const tool = aiCalls[1].input.messages.find((m) => m.role === 'tool').content;
  assert.match(tool, /Title: My Article/);
  assert.match(tool, /Hello world/);
  assert.ok(!/menu|foot|var x=1/.test(tool));
});

test('پنل مدیریت: /panel → توکن → API', async () => {
  reset();
  await send({ text: '/panel' }, U(1000, 'Owner', 'owner'));
  const link = sent(1000).pop().payload.text;
  const tok = link.match(/\/admin\?t=([a-f0-9]+)/)[1];
  const api = (p, body, t = tok) => worker.fetch(new Request('https://w.example.workers.dev/admin/api/' + p, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);
  assert.equal((await api('stats', null, 'wrong')).status, 401);
  const st = await (await api('stats')).json();
  assert.ok(st.users >= 5);
  const users = await (await api('users?q=ali')).json();
  assert.ok(users.users.length >= 1);
  assert.equal((await (await api('user', { id: 2000, plan: 'vip', days: 10 })).json()).ok, true);
  assert.equal(dbq('SELECT plan FROM users WHERE id=2000')[0].plan, 'vip');
  assert.equal((await api('user', { id: 2000, plan: 'nope' })).status, 400);
  assert.equal((await (await api('settings', { extra_prompt: 'همیشه مودب باش', contact: '@sales', limits: JSON.stringify({ pro: { label: 'P', msgs: 5, images: 1 } }) })).json()).ok, true);
  assert.equal((await api('settings', { limits: '{bad' })).status, 400);
  const s = await (await api('settings')).json();
  assert.equal(s.extra_prompt, 'همیشه مودب باش');
  assert.match(s.limits, /"free"/);
  const bc = await (await api('broadcast', { text: 'سلام همگانی', offset: 0 })).json();
  assert.ok(bc.sent >= 5);
  assert.equal(bc.next, null);
  // پنل HTML
  const page = await worker.fetch(new Request('https://w.example.workers.dev/admin'), env);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /پنل مدیریت — تست‌بات/);
  env.DB.raw.prepare("DELETE FROM settings WHERE key='limits'").run();
});

test('cron: وب‌هوک ثبت می‌شود و نام ربات ذخیره می‌شود', async () => {
  reset();
  const waits = [];
  await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const setWh = tgCalls.find((c) => c.method === 'setWebhook');
  assert.equal(setWh.payload.url, 'https://w.example.workers.dev/telegram');
  assert.equal(setWh.payload.secret_token, 'sec');
  assert.ok(tgCalls.some((c) => c.method === 'setMyCommands'));
  assert.equal(dbq("SELECT value FROM settings WHERE key='bot_username'")[0].value, 'testbot');
});

test('صفحه‌ی اصلی: برند + لینک ربات + پلن‌ها', async () => {
  const res = await worker.fetch(new Request('https://w.example.workers.dev/'), env);
  const h = await res.text();
  assert.match(h, /تست‌بات/);
  assert.match(h, /https:\/\/t\.me\/testbot/);
  assert.match(h, /پلن‌ها/);
  assert.equal((await worker.fetch(new Request('https://w.example.workers.dev/nope'), env)).status, 404);
});

test('/boot با کلید درست', async () => {
  const bad = await worker.fetch(new Request('https://w.example.workers.dev/boot?k=x'), env);
  assert.equal(bad.status, 403);
  const ok = await (await worker.fetch(new Request('https://w.example.workers.dev/boot?k=sec'), env)).json();
  assert.equal(ok.ok, true);
  assert.equal(ok.bot, 'testbot');
});

test('/diag برای مالک گزارش می‌دهد', async () => {
  reset();
  await send({ text: '/diag' }, U(1000, 'Owner', 'owner'));
  const rep = sent(1000).pop().payload.text;
  assert.match(rep, /✅ دیتابیس/);
  assert.match(rep, /✅ مدل متنی/);
  assert.match(rep, /✅ فراخوانی ابزار/);
  assert.match(rep, /✅ بینایی/);
  assert.match(rep, /✅ جستجوی وب/);
  assert.match(rep, /✅ ساخت تصویر/);
});

// ---------- ماژول ایتا ----------
const OWNER = U(1000, 'Owner', 'owner');
const cbq = async (data, from = OWNER) => {
  const update = { update_id: ++uid, callback_query: { id: 'cb' + uid, from, data, message: { message_id: uid, chat: { id: from.id, type: 'private' }, date: 0 } } };
  await worker.fetch(new Request('https://w.example.workers.dev/telegram', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'sec', 'content-type': 'application/json' }, body: JSON.stringify(update) }), env);
};
const texts = (id) => sent(id).map((c) => c.payload.text);

test('ایتا: کاربر پلن‌رایگان اشتراک ندارد، مالک دارد', async () => {
  reset();
  await send({ text: '/eitaa' }, U(3999, 'Free', 'free'));
  assert.ok(texts(3999).some((t) => t.includes('اشتراک فعال ندارید')), texts(3999).join('|'));
  await send({ text: '/ai' }, U(3999, 'Free', 'free'));
  reset();
  await send({ text: '/eitaa' }, OWNER);
  const w = sent(1000).find((c) => c.payload.reply_markup && c.payload.reply_markup.keyboard);
  assert.ok(w && JSON.stringify(w.payload.reply_markup.keyboard).includes('بازگشت به هوش مصنوعی'));
  assert.ok(w.payload.text.includes('از منوی پایین شروع کنید'));
});

test('ایتا: در حالت ایتا پیام‌ها به هوش مصنوعی نمی‌رسند؛ بازگشت کار می‌کند', async () => {
  reset();
  await send({ text: 'یک سوال معمولی' }, OWNER);
  assert.equal(aiCalls.length, 0, JSON.stringify(aiCalls.map((c) => c.input.messages.slice(-1))));
  assert.ok(texts(1000).some((t) => t.includes('از منوی پایین')));
  reset();
  await send({ text: '🔙 بازگشت به هوش مصنوعی' }, OWNER);
  assert.ok(sent(1000).some((c) => c.payload.reply_markup && c.payload.reply_markup.remove_keyboard));
  assert.equal(dbq("SELECT value FROM settings WHERE key='eamode:1000'").length, 0);
  reset();
  await send({ text: 'سلام، حالت عادی' }, OWNER);
  assert.ok(aiCalls.length >= 1);
});

test('ایتا: توکن، کانال، پست زمان‌بندی، ایجنت، و ارسال با کران', async () => {
  reset();
  await send({ text: '/eitaa' }, OWNER);
  await send({ text: '🔌 برنامه‌های متصل' }, OWNER);
  await cbq('tk:set');

  await send({ text: '12345:ABCDEFGH' }, OWNER);
  assert.ok(texts(1000).some((t) => t.includes('توکن ایتایار ثبت شد')), JSON.stringify(eitaaCalls));
  assert.equal(dbq('SELECT eitaa_account a FROM ea_users WHERE id=1000')[0].a, 'acc_eitaa');
  assert.notEqual(dbq('SELECT eitaa_token_enc t FROM ea_users WHERE id=1000')[0].t, '12345:ABCDEFGH');
  await send({ text: '📣 کانال‌ها' }, OWNER);
  await cbq('ch:add');
  await send({ text: '@mychannel' }, OWNER);
  await send({ text: 'کانال من' }, OWNER).catch(() => {});
  const ch = dbq('SELECT * FROM ea_channels WHERE user_id=1000');
  assert.equal(ch.length, 1, texts(1000).join('|'));
  // ایجنت: اجرای فوری با مدل شبیه‌سازی‌شده
  env.DB.raw.prepare("INSERT INTO agent_jobs(user_id,channel_id,name,instruction,times,footer,approve,enabled,run_now,last_key,attempts,created_at) VALUES(1000,?,'t','یک متن کوتاه خودت بنویس','[]','🆔 @mychannel',0,1,1,'',0,0)").run(ch[0].id);
  aiQueue.push({ choices: [{ message: { content: '', tool_calls: [{ id: 'a1', type: 'function', function: { name: 'post_to_channel', arguments: JSON.stringify({ text: 'روز خوش' }) } }] } }] });
  reset();
  aiQueue.push({ choices: [{ message: { content: '', tool_calls: [{ id: 'a1', type: 'function', function: { name: 'post_to_channel', arguments: JSON.stringify({ text: 'روز خوش' }) } }] } }] });
  const run = async () => { const w = []; await worker.scheduled({}, env, { waitUntil: (p) => w.push(p) }); await Promise.all(w); };
  await run();
  const posts = dbq('SELECT * FROM ea_posts WHERE job_id IS NOT NULL');
  assert.equal(posts.length, 1);
  assert.ok(posts[0].text.endsWith('🆔 @mychannel') && posts[0].text.startsWith('روز خوش'));
  await run();                                          // تیک بعدی پست آماده را تحویل می‌دهد
  assert.equal(dbq('SELECT status s FROM ea_posts WHERE id=?', posts[0].id)[0].s, 'sent');
  assert.ok(eitaaCalls.some((c) => c.method === 'sendMessage' && String(c.form.text).startsWith('روز خوش')));
});

// ---------- اجرا ----------
let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log('  ✔', name);
  } catch (e) {
    failed++;
    console.log('  ✖', name);
    console.log('     ', String(e.stack || e).split('\n').slice(0, 6).join('\n      '));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} تست موفق`);
process.exit(failed ? 1 : 0);
