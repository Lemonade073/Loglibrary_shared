// 리수 로그 파서. JSON(risuChat ver2) + chatcap HTML 캡처. 브라우저/Node 공용.

const INFOBOARD_RE = /<Info_Board>([\s\S]*?)<\/Info_Board>/i;
const STATLINE_RE = /^C\|(.+)$/gm;
const HEADING_RE = /^#{1,3}\s+(.+)$/gm;

// ── 상태창 해석기 목록 (설정에서 등록한 것들)
let PARSERS = null;
export function setParsers(list) {
  PARSERS = Array.isArray(list) && list.length ? list.filter(p => p.enabled !== false) : null;
}
export function getParsers() { return PARSERS; }

const reEsc = t => String(t ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unSep = t => String(t ?? '').replace(/\\n/g, '\n').replace(/\\t/g, '\t');

// 해석기 하나로 원문에서 상태창을 뽑는다 → { meta, block } | null
export function runParser(p, raw) {
  const text = String(raw ?? '');
  let inner = null, block = null;
  try {
    if (p.mode === 'regex') {
      if (!p.block_regex) return null;
      const m = text.match(new RegExp(p.block_regex, 'i'));
      if (!m) return null;
      block = m[0];
      inner = m[1] ?? m[0];
    } else {
      if (!p.block_open) return null;
      const re = new RegExp(reEsc(p.block_open) + '([\\s\\S]*?)' + reEsc(p.block_close || ''), 'i');
      const m = text.match(re);
      if (!m) return null;
      block = m[0];
      inner = m[1];
    }
  } catch (_) { return null; }

  const meta = {};
  try {
    if (p.mode === 'regex' && p.item_regex) {
      for (const m of inner.matchAll(new RegExp(p.item_regex, 'g'))) {
        const k = (m[1] || '').trim(), v = (m[2] || '').trim();
        if (k && v) meta[k] = v;
      }
    } else {
      const sep = unSep(p.item_sep || '\n');
      const kv = p.kv_sep || ':';
      for (const part of inner.split(sep)) {
        const i = part.indexOf(kv);
        if (i < 1) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + kv.length).trim();
        if (k && v) meta[k] = v;
      }
    }
  } catch (_) { return null; }

  if (!Object.keys(meta).length) return null;
  return { meta, block };
}

// 등록된 것들을 순서대로 시도. 없으면 기본 Info_Board.
function parseStatus(raw) {
  if (PARSERS) {
    for (const p of PARSERS) {
      const r = runParser(p, raw);
      if (r) return { ...r, format: p.name };
    }
    return null;
  }
  const m = String(raw ?? '').match(INFOBOARD_RE);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([A-Za-z_'\s]+?)\s*:\s*(.+?)\s*$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim();
  }
  if (!Object.keys(meta).length) return null;
  return { meta, block: m[0], format: 'infoboard_v1' };
}

function parseStatLines(raw) {
  const out = [];
  let m;
  STATLINE_RE.lastIndex = 0;
  while ((m = STATLINE_RE.exec(raw))) {
    const p = m[1].split('|').map(s => s.trim());
    const num = s => { const n = s?.match(/(-?\d+)\s*\/\s*(\d+)/); return n ? +n[1] : null; };
    out.push({
      name: p[0] || null,
      affection: num(p[1]),
      affection_note: p[3] || null,
      tension: num(p[4]),
      tension_note: p[6] || null,
    });
  }
  return out;
}

function parseHeadings(raw) {
  const r = { volume: null, chapter: null, chapter_no: null, title: null };
  let m;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(raw))) {
    const t = m[1].trim();
    const v = t.match(/^Volume\s+(\d+)\s*:\s*(.+)$/i);
    const c = t.match(/^Chapter\s+(\d+)\s*:\s*(.+)$/i);
    if (v) { r.volume = +v[1]; r.title = v[2]; }
    else if (c) { r.chapter_no = +c[1]; r.chapter = c[2]; }
  }
  return r;
}

function parseSceneAt(meta) {
  if (!meta) return null;
  const d = meta.Date?.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!d) return null;
  let hh = 0, mm = 0;
  const t = meta.Time?.match(/(AM|PM)?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (t) {
    hh = +t[2]; mm = +t[3];
    const ap = (t[1] || t[4] || '').toUpperCase();
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
  }
  const p = n => String(n).padStart(2, '0');
  return `${d[1]}-${p(d[2])}-${p(d[3])}T${p(hh)}:${p(mm)}:00`;
}

function toBodyText(raw, block) {
  let t = String(raw ?? '');
  if (block) t = t.split(block).join('');
  return t
    .replace(INFOBOARD_RE, '')
    .replace(/^\s*```[a-z]*\s*$/gim, '')
    .replace(/^#\s*Response\s*$/gim, '')
    .replace(HEADING_RE, '')
    .replace(/^C\|.+$/gm, '')
    .replace(/<Thoughts>[\s\S]*?<\/Thoughts>/gi, '')
    .replace(/\[inlay:[^\]]*\]/gi, '')
    .replace(/\{+inlay::[^}]+\}+/gi, '')
    .replace(/^\s*(\*\*\*|---)\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const _nonNull = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

function makeMessage(raw, seq, role, extra = {}) {
  const st = parseStatus(raw);
  const meta = st?.meta || null;
  const stats = parseStatLines(raw);
  const head = parseHeadings(raw);
  return {
    seq, role,
    body_raw: raw,
    body_text: toBodyText(raw, st?.block),
    meta_format: st?.format ?? null,
    meta: meta ? { ...meta, _stats: stats, ..._nonNull(head) } : (stats.length ? { _stats: stats } : null),
    scene_at: parseSceneAt(meta),
    location: meta?.Location ?? meta?.['장소'] ?? null,
    volume: head.volume,
    chapter_no: head.chapter_no,
    chapter_title: head.chapter,
    sent_at: null,
    source_msg_id: null,
    ...extra,
  };
}

// 이미 저장된 원문 하나를 정리해서 갱신용 필드만 반환
export function normalizeMessage(raw) {
  const m = makeMessage(raw ?? '', 0, 'char');
  const { _stats, ...metaRest } = m.meta || {};
  return {
    body_text: m.body_text,
    meta: m.meta ? metaRest : null,
    meta_format: m.meta_format,
    scene_at: m.scene_at,
    location: m.location,
    volume: m.volume,
    chapter_no: m.chapter_no,
    chapter_title: m.chapter_title,
    stats: _stats || [],
  };
}

function summarize(messages) {
  const sceneAts = messages.map(m => m.scene_at).filter(Boolean).sort();
  const sentAts = messages.map(m => m.sent_at).filter(Boolean).sort();
  const cast = [...new Set(
    messages.flatMap(m => (m.meta?._stats || []).map(s => s.name)).filter(Boolean)
  )];
  return {
    cast,
    message_count: messages.length,
    started_at: sentAts[0] ?? null,
    scene_from: sceneAts[0] ?? null,
    scene_to: sceneAts.at(-1) ?? null,
  };
}

// ── 리수 채팅 export(JSON)
export function parseRisuChat(json, filename = '') {
  if (json?.type !== 'risuChat') throw new Error('리수 채팅 파일이 아니야 (type: ' + json?.type + ')');
  const d = json.data;

  const messages = (d.message || []).map((m, i) =>
    makeMessage(m.data ?? m.content ?? '', i, m.role === 'user' ? 'user' : 'char', {
      sent_at: m.time ? new Date(m.time).toISOString() : null,
      source_msg_id: m.chatId ?? null,
    }));

  return {
    log: {
      kind: 'origin',
      source_id: d.id,
      title: d.name,
      source_file: filename,
      note: d.note || null,
      hypa: d.hypaV3Data?.summaries ?? [],
      local_lore: d.localLore ?? [],
      binded_persona: d.bindedPersona ?? null,
      binded_preset: d.bindedBotPreset ?? null,
      ...summarize(messages),
    },
    messages,
  };
}

// ── HTML: 리수 자체 내보내기 → 캡처 순으로 시도
export async function parseRisuHtml(html, filename = '', deps = {}) {
  const DP = deps.DOMParser || globalThis.DOMParser;
  const subtle = deps.subtle || globalThis.crypto?.subtle;
  const doc = new DP().parseFromString(html, 'text/html');

  // 리수 내보내기는 원본 JSON을 .idat 안에 통째로 담아둔다
  const idat = doc.querySelector('.idat');
  if (idat) {
    const txt = (idat.textContent || '').trim();
    if (txt) {
      let d = null;
      try { d = JSON.parse(txt); } catch (_) {}
      if (d?.message?.length) {
        const r = parseRisuChat({ type: 'risuChat', ver: 2, data: d }, filename);
        // 리수 내보내기 파일명은 '캐릭터명_날짜_chat.html' 꼴이다
        const base = filename
          .replace(/\.html?$/i, '')
          .replace(/_\d{4}-\d{2}-\d{2}T[\w.-]*_?chat$/i, '')
          .replace(/_chat$/i, '')
          .trim();

        if (!r.log.cast.length) {
          const seen = [...new Set(d.message
            .filter(m => m.role !== 'user')
            .map(m => (m.name || '').trim())
            .filter(t => t && t.length <= 30))];
          if (seen.length) r.log.cast = seen;
          else if (base) r.log.cast = [base.replace(/_/g, ' ')];
        }
        // 제목이 'Chat 1' 같은 기본값이면 파일명을 쓴다
        if (base && /^chat\s*\d*$/i.test(r.log.title || '')) r.log.title = base.replace(/_/g, ' ');
        return r;
      }
    }
  }

  const cap = doc.getElementById('cap') || doc.body;
  if (!cap) throw new Error('내용을 찾을 수 없어');

  const card = (cap.firstElementChild && cap.firstElementChild.children.length > 1)
    ? cap.firstElementChild : cap;
  const blocks = [...card.children];

  const textOf = el => {
    const c = el.cloneNode(true);
    c.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    return (c.textContent || '').replace(/\u00a0/g, ' ').trim();
  };

  let seqStart = 0, charName = null;
  const messages = [];

  for (const b of blocks) {
    const t = textOf(b);
    if (!t) continue;

    const range = t.match(/Messages\s+(\d+)\s*[\u2013\u2014-]\s*(\d+)/i);
    if (range) {
      seqStart = +range[1];
      const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
      const i = lines.findIndex(l => /Messages\s+\d/i.test(l));
      if (i > 0) charName = lines[i - 1];
      continue;
    }
    if (/Captured from RisuAI/i.test(t)) continue;

    const kids = [...b.children];
    if (kids.length >= 2) {
      const name = textOf(kids[0]);
      const raw = kids.slice(1).map(textOf).filter(Boolean).join('\n\n');
      if (!raw) continue;
      messages.push(makeMessage(raw, seqStart + messages.length, 'char', { speaker_label: name }));
    } else if (kids.length === 0 && t.length > 40) {
      messages.push(makeMessage(t, seqStart + messages.length, 'char'));
    }
  }

  if (!messages.length) throw new Error('메시지를 못 찾았어 (리수 내보내기나 채캡 캡처 파일이 맞아?)');

  const sum = summarize(messages);
  const labels = [...new Set(messages.map(m => m.speaker_label).filter(Boolean))];
  const cast = sum.cast.length ? sum.cast : (charName ? [charName] : labels);

  const body = messages.map(m => m.body_raw).join('\u0000');
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');

  return {
    log: {
      kind: 'curated',
      source_id: 'html:' + hex.slice(0, 32),
      title: filename.replace(/\.html?$/i, '') || charName || '캡처',
      source_file: filename,
      note: null, hypa: [], local_lore: [],
      binded_persona: null, binded_preset: null,
      ...sum, cast,
    },
    messages,
  };
}

// ── 리수 텍스트 내보내기 (--화자명 으로 나뉨)
export async function parseRisuTxt(text, filename = '', deps = {}) {
  const subtle = deps.subtle || globalThis.crypto?.subtle;
  const src = String(text || '').replace(/\r\n/g, '\n');

  const marks = [...src.matchAll(/^--(.+)$/gm)];
  if (!marks.length) throw new Error('리수에서 내보낸 텍스트가 아닌 것 같아');

  const parts = marks.map((m, i) => ({
    name: m[1].trim(),
    body: src.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).trim(),
  })).filter(p => p.body);
  if (!parts.length) throw new Error('내용이 없어');

  // 두 화자가 번갈아 나오면 뒤에 오는 쪽(대개 페르소나)이 유저다
  const names = [...new Set(parts.map(p => p.name))];
  const userName = names.length === 2 ? names[1] : null;

  const messages = parts.map((p, i) =>
    makeMessage(p.body, i, p.name === userName ? 'user' : 'char', { speaker_label: p.name }));

  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(parts.map(p => p.body).join('\u0000')));
  const hex = [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');

  const base = filename
    .replace(/\.txt$/i, '')
    .replace(/_\d{4}-\d{2}-\d{2}T[\w.-]*_?chat$/i, '')
    .replace(/_chat$/i, '')
    .trim();

  const sum = summarize(messages);
  const cast = sum.cast.length ? sum.cast
    : names.filter(n => n !== userName).slice(0, 3);

  return {
    log: {
      kind: 'origin',
      source_id: 'txt:' + hex.slice(0, 32),
      title: (base || '텍스트').replace(/_/g, ' '),
      source_file: filename,
      note: null, hypa: [], local_lore: [],
      binded_persona: null, binded_preset: null,
      ...sum, cast,
    },
    messages,
  };
}

// ── 확장자로 자동 분기
export async function parseFile(file) {
  const text = await file.text();
  if (/\.html?$/i.test(file.name)) return parseRisuHtml(text, file.name);
  if (/\.txt$/i.test(file.name)) return parseRisuTxt(text, file.name);
  return parseRisuChat(JSON.parse(text), file.name);
}

// ── 저장
export async function saveToSupabase(sb, parsed, onProgress = () => {}) {
  const { log, messages } = parsed;

  const { data: dup } = await sb.from('logs').select('id').eq('source_id', log.source_id).maybeSingle();
  if (dup) return { skipped: true };

  const charIds = [];
  for (const name of log.cast) {
    const { data: found } = await sb.from('characters').select('id').eq('name', name).maybeSingle();
    if (found) { charIds.push(found.id); continue; }
    const { data: made, error } = await sb.from('characters').insert({ name }).select('id').single();
    if (error) throw error;
    charIds.push(made.id);
  }

  const { cast, ...logRowData } = log;
  const { data: logRow, error: logErr } = await sb.from('logs')
    .insert(logRowData).select('id').single();
  if (logErr) throw logErr;

  if (charIds.length) {
    await sb.from('log_cast').insert(charIds.map(cid => ({ log_id: logRow.id, character_id: cid })));
  }

  const rows = messages.map(m => {
    const { _stats, ...metaRest } = m.meta || {};
    return {
      log_id: logRow.id,
      seq: m.seq, role: m.role,
      body_raw: m.body_raw, body_text: m.body_text,
      meta: m.meta ? metaRest : null,
      meta_format: m.meta_format,
      sent_at: m.sent_at, scene_at: m.scene_at,
      location: m.location, volume: m.volume,
      chapter_no: m.chapter_no, chapter_title: m.chapter_title,
      source_msg_id: m.source_msg_id,
    };
  });

  const inserted = [];
  for (let i = 0; i < rows.length; i += 100) {
    const { data, error } = await sb.from('messages').insert(rows.slice(i, i + 100)).select('id, seq');
    if (error) throw error;
    inserted.push(...data);
    onProgress(Math.min(i + 100, rows.length), rows.length);
  }

  const seqToId = Object.fromEntries(inserted.map(r => [r.seq, r.id]));
  const stats = messages.flatMap(m =>
    (m.meta?._stats ?? []).map(s => ({
      message_id: seqToId[m.seq],
      char_name: s.name,
      affection: s.affection,
      tension: s.tension,
      notes: { affection_note: s.affection_note, tension_note: s.tension_note },
    })));
  if (stats.length) {
    const { error } = await sb.from('message_stats').insert(stats);
    if (error) throw error;
  }

  return { skipped: false, messages: inserted.length, stats: stats.length };
}
