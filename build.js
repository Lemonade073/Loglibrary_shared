// 배포할 때 환경변수로 받은 Supabase 정보를 config.js 로 굽습니다.
//
//   SUPABASE_URL       https://xxxxxxxx.supabase.co
//   SUPABASE_ANON_KEY  anon public 키
//
// Vercel / Netlify 배포 버튼을 누르면 두 값을 입력하는 칸이 나옵니다.
// 로컬에서는 config.js 를 직접 만들어 두면 이 스크립트가 건드리지 않습니다.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'config.js');
const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = (process.env.SUPABASE_ANON_KEY || '').trim();

const die = (msg) => {
  console.error('\n[로그 도서관] 설정을 굽지 못했습니다.\n' + msg + '\n');
  process.exit(1);
};

if (!url && !key) {
  if (fs.existsSync(OUT)) {
    console.log('[로그 도서관] 환경변수가 없어 기존 config.js 를 그대로 씁니다.');
    process.exit(0);
  }
  die(
    'SUPABASE_URL 과 SUPABASE_ANON_KEY 를 환경변수로 넣어주세요.\n' +
    'Vercel 이면  Settings → Environment Variables,\n' +
    'Netlify 면   Site settings → Environment variables 에서 넣습니다.'
  );
}

if (!url) die('SUPABASE_URL 이 비어 있습니다.');
if (!key) die('SUPABASE_ANON_KEY 가 비어 있습니다.');

if (!/^https:\/\/[^/]+$/.test(url)) {
  die(
    'SUPABASE_URL 이 이상합니다: ' + url + '\n' +
    'https://xxxxxxxx.supabase.co 형태여야 합니다 (끝에 / 나 경로 없이).'
  );
}

// service_role 키를 넣으면 RLS가 통째로 무시돼서 아무나 데이터를 읽게 됩니다.
// 여기서 막습니다.
const looksSecret = () => {
  if (/^sb_secret_/.test(key)) return true;
  const part = key.split('.')[1];
  if (!part) return false;
  try {
    const pad = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(pad, 'base64').toString('utf8'));
    return json.role === 'service_role';
  } catch {
    return false;
  }
};

if (looksSecret()) {
  die(
    'service_role(secret) 키가 들어왔습니다. 절대 쓰면 안 됩니다.\n' +
    '이 키는 행 수준 보안을 통째로 무시해서, 사이트에 들어온 누구나\n' +
    '로그인 없이 모든 로그를 읽고 지울 수 있게 됩니다.\n\n' +
    'Supabase → Settings → API 에서 anon public 키를 대신 넣어주세요.'
  );
}

fs.writeFileSync(
  OUT,
  '// 이 파일은 build.js 가 환경변수로부터 자동 생성했습니다. 직접 고치지 마세요.\n' +
  'export const CFG = {\n' +
  '  url: ' + JSON.stringify(url) + ',\n' +
  '  key: ' + JSON.stringify(key) + ',\n' +
  '};\n'
);

console.log('[로그 도서관] config.js 를 만들었습니다 — ' + url);
