// 테마와 글꼴. 모든 페이지가 이걸 쓴다.

export const BASE_THEMES = [
  { value: 'white', name: '순백',   vars: { paper:'#FFFFFF', paper2:'#FFFFFF', ink:'#1A1A1A', ink2:'#5C5C5C', ink3:'#9A9A9A', rule:'#EAEAEA', accent:'#4A5A47', soft:'#F2F4F1' } },
  { value: 'day',   name: '종이',   vars: { paper:'#F7F5F0', paper2:'#FFFFFF', ink:'#22201C', ink2:'#6B665C', ink3:'#9C968A', rule:'#E2DED4', accent:'#5B6B58', soft:'#EDF0EA' } },
  { value: 'sepia', name: '세피아', vars: { paper:'#EFE6D6', paper2:'#F7F0E3', ink:'#3A3227', ink2:'#7A6E5C', ink3:'#A0937D', rule:'#DDD1BC', accent:'#8A6A3E', soft:'#E7DCC6' } },
  { value: 'night', name: '밤',     vars: { paper:'#16171A', paper2:'#1D1F23', ink:'#DBD8D1', ink2:'#948F86', ink3:'#6A665F', rule:'#2C2F34', accent:'#8FA88A', soft:'#232821' } },
];

export const BASE_FONTS = [
  { value: 'ridi',   name: '리디바탕', family: "'RIDIBatang','Segoe UI Symbol',serif",       weights: [400] },
  { value: 'batang', name: '고운바탕', family: "'Gowun Batang','Segoe UI Symbol',serif",     weights: [400, 700] },
  { value: 'noto',   name: '노토명조', family: "'Noto Serif KR','Segoe UI Symbol',serif",    weights: [200, 300, 400, 500, 600, 700] },
  { value: 'sans',   name: '고딕',     family: "'IBM Plex Sans KR','Segoe UI Symbol',sans-serif", weights: [300, 400, 500] },
];

export const WEIGHT_NAME = {
  200: '아주 얇게', 300: '얇게', 400: '보통',
  500: '도톰', 600: '조금 굵게', 700: '굵게',
};

let custom = { themes: [], fonts: [] };

export function getThemes() { return [...BASE_THEMES, ...custom.themes]; }
export function getFonts()  { return [...BASE_FONTS,  ...custom.fonts];  }

export function findFont(v) {
  return getFonts().find(f => f.value === v) || BASE_FONTS[0];
}

const VAR_MAP = {
  paper: '--paper', paper2: '--paper-2', ink: '--ink', ink2: '--ink-2',
  ink3: '--ink-3', rule: '--rule', accent: '--accent', soft: '--accent-soft',
};

// DB에서 사용자가 만든 테마·글꼴을 읽어 페이지에 심는다
export async function loadStyles(sb) {
  let rows = [];
  try {
    const { data, error } = await sb.from('styles').select('*').order('sort');
    if (!error && data) rows = data;
  } catch (_) {}

  custom = { themes: [], fonts: [] };
  let css = '';

  for (const r of rows) {
    if (r.kind === 'theme' && r.vars) {
      const value = 'c_' + r.id.slice(0, 8);
      custom.themes.push({ value, name: r.name, vars: r.vars, id: r.id });
      const body = Object.entries(VAR_MAP)
        .filter(([k]) => r.vars[k])
        .map(([k, cssVar]) => `${cssVar}:${r.vars[k]}`).join(';');
      css += `[data-theme="${value}"]{${body}}\n`;
    }
    if (r.kind === 'font' && r.family) {
      const value = 'f_' + r.id.slice(0, 8);
      const weights = String(r.weights || '400').split(',')
        .map(x => parseInt(x.trim(), 10)).filter(Boolean).sort((a, b) => a - b);
      custom.fonts.push({ value, name: r.name, family: r.family, weights, css_url: r.css_url, id: r.id });
      if (r.css_url) {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = r.css_url;
        document.head.appendChild(l);
      }
    }
  }

  if (css) {
    let el = document.getElementById('custom-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'custom-style';
      document.head.appendChild(el);
    }
    el.textContent = css;
  }
  return custom;
}

export function applyTheme(v) {
  document.documentElement.dataset.theme = v || 'day';
}
