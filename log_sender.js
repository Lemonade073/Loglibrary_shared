//@name log_sender
//@display-name Log Sender
//@api 3.0
//@version 0.3.0
//@arg supabase_url string Supabase 프로젝트 주소 (https://xxxx.supabase.co)
//@arg anon_key string Supabase anon public 키
//@arg ingest_secret string 수집 시크릿 (app_secrets 에 넣은 값)

let KINDS = [
  ['origin', '원본 채팅방'],
  ['good', '느좋 로그'],
  ['ooc', 'OOC'],
];

async function loadKinds(conf) {
  if (!conf.url || !conf.key) return;
  try {
    const res = await Risuai.nativeFetch(
      `${conf.url}/rest/v1/kinds?select=value,label&order=sort`,
      { method: 'GET', headers: { 'apikey': conf.key } });
    if (!res.ok) return;
    const rows = JSON.parse(await res.text());
    if (Array.isArray(rows) && rows.length) KINDS = rows.map(r => [r.value, r.label]);
  } catch (_) {}
}
const CHUNK = 40;

let chats = [];          // 채팅방 목록
let picked = new Set();  // 통째로 보낼 채팅방
let mode = 'range';      // range | whole
let openChat = null;     // 범위 모드에서 펼친 채팅방
let msgs = [];           // 그 채팅방의 메시지
let n = 5;               // 최근 몇 편
let shown = 20;          // 목록에 펼친 개수
let kind = 'origin';
let busy = false;

// ── 설정 ──────────────────────────────────────────────────────────
async function cfg() {
  const url = (await Risuai.getArgument('supabase_url') || '').trim().replace(/\/+$/, '');
  const key = (await Risuai.getArgument('anon_key') || '').trim();
  const sec = (await Risuai.getArgument('ingest_secret') || '').trim();
  return { url, key, sec };
}

// ── 데이터 ────────────────────────────────────────────────────────
async function loadChats() {
  const ci = await Risuai.getCurrentCharacterIndex();
  const char = await Risuai.getCharacter();
  const cur = await Risuai.getCurrentChatIndex();

  let list = Array.isArray(char?.chats) ? char.chats : null;
  if (!list) {
    list = [];
    for (let i = 0; i < 60; i++) {
      const c = await Risuai.getChatFromIndex(ci, i).catch(() => null);
      if (!c) break;
      list.push(c);
    }
  }

  return list.map((c, i) => ({
    i,
    name: c?.name || `Chat ${i + 1}`,
    n: (c?.message || c?.messages || []).length,
    cur: i === cur,
    raw: c,
  })).filter(c => c.n > 0);
}

function rowsOf(chat) {
  const raw = chat.raw.message || chat.raw.messages || [];
  return raw.map((m, i) => {
    const body = m.data ?? m.content ?? m.value ?? '';
    return {
      seq: i,
      role: m.role === 'user' ? 'user' : 'char',
      body_raw: body,
      sent_at: m.time ? new Date(m.time).toISOString() : null,
      source_msg_id: m.chatId ?? null,
      peek: preview(body),
    };
  });
}

// 목록에 보여줄 한 줄 미리보기 — 상태창/헤딩/코드펜스 걷어냄
function preview(raw) {
  return String(raw || '')
    .replace(/<Info_Board>[\s\S]*?<\/Info_Board>/i, '')
    .replace(/\[\s*상태창[\s\S]*?\]/g, '')
    .replace(/\[[^\[\]\n]*\|[^\[\]\n]*\]/g, '')
    .replace(/<Thoughts>[\s\S]*?<\/Thoughts>/gi, '')
    .replace(/^\s*```[a-z]*\s*$/gim, '')
    .replace(/^#{1,3}\s+.*$/gm, '')
    .replace(/^C\|.+$/gm, '')
    .replace(/\[inlay:[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
}

// ── 페이로드 ──────────────────────────────────────────────────────
function payloadWhole(chat) {
  const c = chat.raw;
  return {
    source_id: c.id || `risu:${chat.name}:${chat.n}`,
    title: chat.name,
    kind,
    note: c.note || null,
    hypa: c.hypaV3Data?.summaries ?? [],
    local_lore: c.localLore ?? [],
    binded_persona: c.bindedPersona ?? null,
    binded_preset: c.bindedBotPreset ?? null,
    messages: rowsOf(chat).map(({ peek, ...m }) => m),
  };
}

function payloadRange(chat, from, to, title) {
  const c = chat.raw;
  return {
    source_id: `${c.id || chat.name}#${from}-${to}`,
    title: title || `${chat.name} ${from + 1}–${to + 1}`,
    kind,
    note: null,
    hypa: [],
    local_lore: [],
    binded_persona: c.bindedPersona ?? null,
    binded_preset: c.bindedBotPreset ?? null,
    messages: rowsOf(chat).slice(from, to + 1).map(({ peek, ...m }) => m),
  };
}

// ── 전송 ──────────────────────────────────────────────────────────
async function callIngest(conf, payload) {
  const res = await Risuai.nativeFetch(`${conf.url}/rest/v1/rpc/ingest_chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': conf.key },
    body: JSON.stringify({ p_secret: conf.sec, p_chat: payload }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text)?.message || text; } catch (_) {}
    throw new Error(`${res.status} ${String(msg).slice(0, 200)}`);
  }
  try { return JSON.parse(text); } catch (_) { return { added: 0 }; }
}

async function sendPayload(conf, full, label, onStep) {
  const all = full.messages;
  let added = 0, total = 0;
  for (let i = 0; i < all.length; i += CHUNK) {
    const r = await callIngest(conf, { ...full, messages: all.slice(i, i + CHUNK) });
    added += r.added || 0;
    total = r.total || total;
    onStep(`${label} — ${Math.min(i + CHUNK, all.length)}/${all.length}편`);
  }
  return { added, total };
}

// ── UI ────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function shell() {
  document.head.innerHTML = '';
  document.body.innerHTML = '';

  const vp = document.createElement('meta');
  vp.name = 'viewport';
  vp.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
  document.head.appendChild(vp);

  const st = document.createElement('style');
  st.textContent = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:-apple-system,'Apple SD Gothic Neo',system-ui,sans-serif;
  background:rgba(20,18,14,.42);color:#26241f;padding:12px;
  display:flex;align-items:center;justify-content:center;pointer-events:none}
.wrap{width:360px;height:75vh;max-height:650px;background:#F7F5F0;border-radius:16px;
  padding:15px;box-shadow:0 10px 30px rgba(0,0,0,.28);
  display:flex;flex-direction:column;overflow:hidden;pointer-events:auto}
@media (max-width:600px){
  .wrap{width:92vw;height:80vh}
}
.top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
h1{font-size:15px;font-weight:700;color:#5B6B58}
.sub{font-size:11px;color:#9C968A;margin-top:2px}
.x{border:none;background:none;font-size:19px;color:#9C968A;cursor:pointer;line-height:1}
.tabs{display:flex;gap:5px;margin-bottom:9px}
.tabs button{flex:1;font-size:11.5px;padding:7px 4px;border-radius:9px;border:1px solid #E2DED4;
  background:transparent;color:#6B665C;cursor:pointer}
.tabs button.on{border-color:#5B6B58;color:#5B6B58;background:#EDF0EA;font-weight:700}
.krow{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:9px}
.krow button{font-size:10.5px;padding:3px 9px;border-radius:15px;border:1px solid #E2DED4;
  background:transparent;color:#6B665C;cursor:pointer}
.krow button.on{border-color:#5B6B58;color:#5B6B58;background:#EDF0EA}
.list{flex:1;min-height:0;overflow-y:auto;border:1px solid #E2DED4;border-radius:11px;
  background:#fff;margin-bottom:10px}
.row{padding:8px 10px;border-bottom:1px solid #EDEAE2;cursor:pointer;
  display:flex;gap:8px;align-items:center}
.row:last-child{border-bottom:none}
.row.on{background:#F4F6F2}
.row.in{background:#F9F7F0}
.ck{width:16px;height:16px;border-radius:5px;border:1.5px solid #E2DED4;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff}
.row.on .ck{background:#5B6B58;border-color:#5B6B58}
.no{width:26px;flex-shrink:0;font-size:10.5px;color:#B9B2A4;text-align:right}
.bd{flex:1;min-width:0}
.nm{font-size:12px;color:#26241f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm.u{color:#8A8377}
.mt{font-size:10.5px;color:#9C968A;margin-top:1px}
.cur{font-size:10px;color:#5B6B58;background:#EDF0EA;padding:1px 6px;border-radius:10px}
.navbar{display:flex;align-items:center;gap:9px;margin-bottom:9px}
.navbar .back{font-size:11.5px;color:#5B6B58;background:#EDF0EA;border:1px solid #DDE3D9;
  border-radius:15px;padding:4px 11px;cursor:pointer;white-space:nowrap;flex-shrink:0}
.navbar .back:hover{background:#E3E9DF}
.navbar .now{font-size:11.5px;color:#6B665C;min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.navbar .now b{color:#26241f;font-weight:700}
.step{display:flex;align-items:center;gap:9px;padding:8px 11px;margin-bottom:9px;
  background:#fff;border:1px solid #E2DED4;border-radius:11px}
.step .lb{font-size:12px;color:#6B665C;flex:1}
.step .pm{width:29px;height:29px;border-radius:9px;border:1px solid #E2DED4;
  background:#F7F5F0;font-size:16px;line-height:1;color:#5B6B58;cursor:pointer;
  display:flex;align-items:center;justify-content:center}
.step .pm:disabled{opacity:.3;cursor:default}
.step .val{min-width:52px;text-align:center;font-size:15px;font-weight:700;color:#26241f}
.step .val small{font-size:11px;font-weight:400;color:#9C968A;margin-left:2px}
.more{width:100%;padding:9px;font-size:11.5px;color:#6B665C;background:#F9F8F4;
  border:none;border-top:1px solid #EDEAE2;cursor:pointer}
.more:hover{color:#5B6B58}
.tin{width:100%;padding:8px 11px;border:1px solid #E2DED4;border-radius:9px;
  font-size:12.5px;margin-bottom:9px;outline:none;font-family:inherit;background:#fff}
.tin:focus{border-color:#5B6B58}
.go{width:100%;background:#26241f;color:#F7F5F0;border:none;border-radius:10px;
  padding:11px;font-size:13.5px;font-weight:700;cursor:pointer}
.go:disabled{opacity:.35;cursor:default}
.msg{font-size:11.5px;color:#6B665C;margin-top:8px;text-align:center;min-height:15px;
  white-space:pre-wrap;line-height:1.5}
.msg.err{color:#B4544A}
.msg.ok{color:#5B6B58}
`;
  document.head.appendChild(st);

  const root = document.createElement('div');
  root.innerHTML = `
    <div class="wrap">
      <div class="top">
        <div><h1>Log Sender</h1><div class="sub" id="sub">로그 도서관으로 전송할 채팅을 골라주세요</div></div>
        <button class="x" id="x">✕</button>
      </div>
      <div class="tabs">
        <button data-m="range">개별 채팅 전송</button>
        <button data-m="whole">전체 채팅 전송</button>
      </div>
      <div class="krow" id="krow">
        ${KINDS.map(([v, t]) => `<button data-k="${v}">${t}</button>`).join('')}
      </div>
      <div id="extra"></div>
      <div class="list" id="list"></div>
      <button class="go" id="go" disabled></button>
      <div class="msg" id="msg"></div>
    </div>`;
  document.body.appendChild(root);

  document.getElementById('x').onclick = () => Risuai.hideContainer();
  document.querySelector('.tabs').onclick = e => {
    const t = e.target.closest('[data-m]');
    if (!t || busy) return;
    mode = t.dataset.m;
    openChat = null; n = 5; shown = 20;
    paint();
  };
  document.getElementById('krow').onclick = e => {
    const t = e.target.closest('[data-k]');
    if (!t || busy) return;
    kind = t.dataset.k;
    paint();
  };
  document.getElementById('go').onclick = send;
}

function paint() {
  document.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === mode));
  const kr = document.getElementById('krow');
  if (kr.dataset.n !== String(KINDS.length)) {
    kr.dataset.n = String(KINDS.length);
    kr.innerHTML = KINDS.map(([v, t]) => `<button data-k="${v}">${esc(t)}</button>`).join('');
  }
  if (!KINDS.some(([v]) => v === kind)) kind = KINDS[0]?.[0] || 'origin';
  document.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x.dataset.k === kind));

  const sub = document.getElementById('sub');
  const list = document.getElementById('list');
  const extra = document.getElementById('extra');
  const go = document.getElementById('go');

  if (mode === 'whole') {
    sub.textContent = '로그 도서관으로 전송할 채팅을 골라주세요';
    extra.innerHTML = '';
    list.innerHTML = chats.map((c, i) => `
      <div class="row ${picked.has(i) ? 'on' : ''}" data-i="${i}">
        <div class="ck">${picked.has(i) ? '✓' : ''}</div>
        <div class="bd"><div class="nm">${esc(c.name)}</div><div class="mt">${c.n}편</div></div>
        ${c.cur ? '<span class="cur">지금</span>' : ''}
      </div>`).join('');
    list.onclick = e => {
      const r = e.target.closest('[data-i]');
      if (!r || busy) return;
      const i = +r.dataset.i;
      picked.has(i) ? picked.delete(i) : picked.add(i);
      paint();
    };
    go.disabled = picked.size === 0 || busy;
    go.textContent = picked.size === 0 ? '채팅방을 골라줘' : `${picked.size}개 보내기`;
    return;
  }

  // ── 범위 모드
  if (!openChat) {
    sub.textContent = '로그 도서관으로 전송할 채팅을 골라주세요';
    extra.innerHTML = '';
    list.innerHTML = chats.map((c, i) => `
      <div class="row" data-open="${i}">
        <div class="bd"><div class="nm">${esc(c.name)}</div><div class="mt">${c.n}편</div></div>
        ${c.cur ? '<span class="cur">지금</span>' : ''}
      </div>`).join('');
    list.onclick = e => {
      const r = e.target.closest('[data-open]');
      if (!r || busy) return;
      openChat = chats[+r.dataset.open];
      msgs = rowsOf(openChat);
      n = Math.min(5, msgs.length);
      shown = 20;
      paint();
    };
    go.disabled = true;
    go.textContent = '채팅방을 골라줘';
    return;
  }

  const total = msgs.length;
  const take = Math.min(n, total);
  const lo = total - take;              // 최근 take편 = 뒤에서 take개

  sub.textContent = `최근 ${take}편 · ${lo + 1}~${total}편`;

  extra.innerHTML = `
    <div class="navbar">
      <button class="back" id="bk">← 뒤로 가기</button>
      <span class="now">현재: <b>${esc(openChat.name)}</b></span>
    </div>
    <div class="step">
      <span class="lb">최근 몇 편</span>
      <button class="pm" id="mn" ${take <= 1 ? 'disabled' : ''}>−</button>
      <span class="val">${take}<small>편</small></span>
      <button class="pm" id="pl" ${take >= Math.min(20, total) ? 'disabled' : ''}>＋</button>
    </div>
    <input class="tin" id="ttl" placeholder="제목 (비우면 자동)" value="">`;

  document.getElementById('bk').onclick = () => { openChat = null; n = 5; shown = 20; paint(); };
  document.getElementById('mn').onclick = () => { n = Math.max(1, take - 1); paint(); };
  document.getElementById('pl').onclick = () => { n = Math.min(20, total, take + 1); paint(); };

  // 최신이 맨 위 + 처음엔 shown개만
  const view = [...msgs].reverse().slice(0, Math.max(shown, take));
  list.innerHTML = view.map(m => {
    const on = m.seq >= lo;
    return `<div class="row ${on ? 'on' : ''}" data-s="${m.seq}">
      <div class="ck">${on ? '✓' : ''}</div>
      <div class="no">${m.seq + 1}</div>
      <div class="bd"><div class="nm ${m.role === 'user' ? 'u' : ''}">${esc(m.peek) || '(빈 메시지)'}</div></div>
    </div>`;
  }).join('') +
  (view.length < total ? `<button class="more" id="mo">이전 ${Math.min(20, total - view.length)}편 더</button>` : '');

  list.onclick = e => {
    if (busy) return;
    if (e.target.closest('#mo')) { shown = Math.min(total, shown + 20); paint(); return; }
    const r = e.target.closest('[data-s]');
    if (!r) return;
    // 누른 편부터 최신까지
    n = Math.min(20, total - +r.dataset.s);
    paint();
  };

  go.disabled = busy;
  go.textContent = `최근 ${take}편 보내기`;
}

function say(t, cls) {
  const m = document.getElementById('msg');
  if (m) { m.textContent = t; m.className = 'msg' + (cls ? ' ' + cls : ''); }
}

async function send() {
  const conf = await cfg();
  if (!conf.url || !conf.key || !conf.sec) {
    return say('플러그인 설정에서 주소·키·시크릿을 먼저 채워줘', 'err');
  }

  busy = true;
  document.getElementById('go').disabled = true;

  try {
    if (mode === 'whole') {
      let done = 0, added = 0;
      for (const i of [...picked].sort((x, y) => x - y)) {
        const c = chats[i];
        const r = await sendPayload(conf, payloadWhole(c), c.name, t => say(t));
        added += r.added; done++;
      }
      picked.clear();
      say(`${done}개 채팅방 · 새로 ${added}편 저장했어`, 'ok');
    } else {
      const total = msgs.length;
      const take = Math.min(n, total);
      const lo = total - take, hi = total - 1;
      const title = (document.getElementById('ttl')?.value || '').trim();
      const p = payloadRange(openChat, lo, hi, title);
      const r = await sendPayload(conf, p, p.title, t => say(t));
      say(`'${p.title}' · 새로 ${r.added}편 저장했어`, 'ok');
    }
  } catch (err) {
    busy = false;
    paint();
    return say('실패\n' + err.message, 'err');
  }

  busy = false;
  paint();
}

// ── 진입 ──────────────────────────────────────────────────────────
async function open() {
  const conf = await cfg();
  await loadKinds(conf);
  chats = await loadChats();
  if (!chats.length) { console.log('[Log Sender] 채팅 없음'); return; }

  picked = new Set();
  mode = 'range'; openChat = null; n = 5; shown = 20;
  const cur = await Risuai.getCurrentChatIndex();
  const here = chats.findIndex(c => c.i === cur);
  if (here >= 0) {
    picked.add(here);
    openChat = chats[here];          // 개별 모드에서 바로 현재 채팅방
    msgs = rowsOf(openChat);
    n = Math.min(5, msgs.length);
  }

  shell();
  paint();
  await Risuai.showContainer('fullscreen');
}

(async () => {
  await Risuai.registerButton(
    { name: 'Log Sender', icon: '📤', iconType: 'html', location: 'chat', id: 'log-sender-btn' },
    open
  );
  console.log('[Log Sender] v0.3.0 로드 완료');
})();
