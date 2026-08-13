# 로그 도서관

RisuAI 채팅 로그를 모아두고 이북 리더처럼 읽는 개인용 웹사이트입니다.

- 리수 채팅 내보내기(JSON · HTML · TXT)를 그대로 읽어들입니다
- 상태창을 리더 형식으로 보여줍니다
- 캐릭터 · 폴더 · 태그로 정리하고, 읽던 위치를 기억합니다
- 리수 플러그인으로 채팅을 바로 밀어넣을 수 있습니다
- 로그를 HTML · 마크다운 · 텍스트로 내보낼 수 있습니다

혼자 쓰는 것을 전제로 만들었습니다. **각자 자기 Supabase에 자기 사이트를 세워서 씁니다.**
남의 서버에 로그가 올라가는 일은 없고, 로그인한 본인만 자기 데이터를 봅니다.

---

## 설치

준비물은 **Supabase 계정**과 **Vercel(또는 Netlify) 계정** 둘뿐입니다. 둘 다 무료 범위로 충분합니다.
로그 100편짜리 100권을 넣어도 수십 MB 정도입니다.

전부 합쳐 10분쯤 걸립니다. 코드를 건드릴 일은 없습니다.

### 1. Supabase 프로젝트 만들기

[supabase.com](https://supabase.com) → **New project** → 리전은 가까운 곳(한국이면 Seoul).

프로젝트가 다 만들어질 때까지 1~2분 기다립니다.

### 2. SQL 실행

이 저장소의 [`setup.sql`](setup.sql)을 통째로 복사해서, Supabase 왼쪽 메뉴의
**SQL Editor**에 붙여넣고 **Run**을 누릅니다.

> **고칠 곳 없습니다.** 예전 버전과 달리 UUID나 시크릿을 직접 채워 넣지 않아도 됩니다.
> 주인 계정과 수집 시크릿은 알아서 정해집니다.
> 나중에 다시 돌려도 데이터와 시크릿은 그대로 유지됩니다.

### 3. URL과 키 복사

**Settings → API**(또는 Data API)에서 두 값을 복사해둡니다.

| 항목 | 생김새 |
|---|---|
| Project URL | `https://xxxxxxxx.supabase.co` |
| anon **public** 키 | `eyJhbGc...` 또는 `sb_publishable_...` |

> `service_role`(secret) 키는 절대 쓰지 마세요. 행 수준 보안을 통째로 무시해서
> 사이트에 들어온 아무나 로그를 다 읽게 됩니다.
> 실수로 넣으면 배포가 실패하면서 경고가 뜨도록 막아뒀습니다.

### 4. 배포

아래 버튼을 누르면 이 저장소가 **자기 GitHub 계정으로 복사되고 사이트까지 자동으로 올라갑니다.**
중간에 나오는 칸에 3단계에서 복사한 두 값을 붙여넣으면 끝입니다.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FLemonade073%2FLoglibrary_shared&env=SUPABASE_URL,SUPABASE_ANON_KEY&envDescription=3%EB%8B%A8%EA%B3%84%EC%97%90%EC%84%9C%20%EB%B3%B5%EC%82%AC%ED%95%9C%20Supabase%20Project%20URL%20%EA%B3%BC%20anon%20public%20%ED%82%A4&project-name=log-library&repository-name=log-library)

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/Lemonade073/Loglibrary_shared)

| 입력 칸 | 넣을 값 |
|---|---|
| `SUPABASE_URL` | Project URL (끝에 `/` 없이) |
| `SUPABASE_ANON_KEY` | anon public 키 |

배포가 끝나면 `https://내프로젝트.vercel.app` 같은 주소가 나옵니다.

### 5. 계정 만들기

Supabase → **Authentication → Users → Create new user**

이메일과 비밀번호를 직접 넣고, `Auto Confirm User`를 켜둡니다.

> **이 프로젝트에서 가장 먼저 만들어진 계정이 자동으로 주인이 됩니다.**
> 주인만 데이터를 읽고 쓸 수 있습니다. 계정을 더 만들어도 그 계정들은 아무것도 못 봅니다.

### 6. 로그인

4단계에서 나온 주소로 들어가 방금 만든 계정으로 로그인하면 끝입니다.

---

## 리수 플러그인 (선택)

리수에서 채팅을 사이트로 바로 밀어넣고 싶을 때만 하면 됩니다.

[`log_sender.js`](log_sender.js)를 리수 플러그인으로 추가하고, 플러그인 설정의 세 칸을 채웁니다.
세 값 모두 **사이트의 설정 → 리수 플러그인** 화면에 복사 버튼과 함께 그대로 나와 있습니다.

| 칸 | 값 |
|---|---|
| `supabase_url` | Project URL (끝에 `/` 없이) |
| `anon_key` | anon public 키 |
| `ingest_secret` | 설치할 때 자동 생성된 수집 시크릿 |

채팅창의 📤 버튼을 누르면 씁니다.

- **개별 채팅 전송** — 최근 몇 편만 골라서
- **전체 채팅 전송** — 채팅방 통째로

같은 채팅을 다시 보내면 늘어난 만큼만 추가됩니다.

> 플러그인은 원문만 보냅니다. 상태창 해석은 사이트에서 이뤄지므로,
> 보낸 뒤 설정 → 상태창 등록 → `못 읽은 것만 다시`를 눌러주세요.

---

## 쓰는 법

**로그 넣기** — 대문 → 로그 추가하기 → 파일을 끌어다 놓기

리수에서 내보낸 HTML에는 원본 데이터가 함께 담겨 있어 JSON과 똑같이 읽힙니다.
TXT는 `--화자명` 구분을 따라 나눕니다. 채캡 캡처 HTML은 캡처한 구간만 별도 로그로 들어갑니다.

**정리하기** — 도서관 → `선택` → 로그 체크 → `캐릭터` 로 캐릭터를 붙이고,
캐릭터 화면에서 다시 `선택` → `폴더로` 로 폴더에 나눠 담습니다.

**읽기** — 로그를 누르면 리더가 열립니다. `Aa`에서 테마 · 글꼴 · 굵기 · 줄간격을 조절하고,
좌우 화면을 눌러 넘기거나 🔓 버튼으로 화면을 잠글 수 있습니다.

**상태창이 안 읽힐 때** — 설정 → 상태창 등록에서 자기 카드 모양을 등록합니다.
메시지를 붙여넣으면 제대로 읽히는지 바로 확인할 수 있습니다.
등록한 뒤 `모든 로그 다시 읽기`를 누르면 이미 넣어둔 로그에도 적용됩니다.

**테마 만들기** — 설정 → 테마 → `＋ 새 테마`.
기존 테마의 JSON을 복사해 AI에게 색 조합을 부탁한 뒤 붙여넣으면 됩니다.

**백업** — 설정 → 백업 → `전체 내려받기`.
원문까지 통째로 담기므로 이 파일 하나로 다시 세울 수 있습니다.

---

## 아이콘 (선택)

홈 화면에 앱처럼 추가하려면 아이콘 파일이 필요합니다.
[realfavicongenerator.net](https://realfavicongenerator.net)에 정사각형 이미지를 올려
아래 이름으로 받아 같은 폴더에 넣고 다시 올리면 됩니다.

```
favicon.ico
favicon-96x96.png
apple-touch-icon.png
web-app-manifest-192x192.png
web-app-manifest-512x512.png
site.webmanifest
```

`site.webmanifest`는 `name`과 색만 취향대로 고치면 됩니다.

---

## 직접 돌려보기 (개발자용)

배포 버튼을 쓰지 않고 로컬에서 열어보려면, [`config.example.js`](config.example.js)를
복사해 **`config.js`** 로 이름을 바꾸고 자기 값을 채운 뒤:

```bash
npx serve
```

파일을 더블클릭하는 방식으로는 열리지 않습니다 (ES 모듈이라 서버가 필요합니다).

`config.js`는 `.gitignore`에 들어 있어 실수로 올라가지 않습니다.
배포할 때는 [`build.js`](build.js)가 환경변수를 읽어 이 파일을 자동으로 만듭니다.

> **GitHub Pages에 올릴 때 주의** — Pages는 빌드 스크립트를 돌리지 않습니다.
> `config.js`를 직접 만들어 커밋하거나(그러면 저장소에 URL과 anon 키가 남습니다),
> GitHub Actions에서 `node build.js`를 돌리도록 따로 설정해야 합니다.
> 그냥 Vercel이나 Netlify를 쓰는 쪽이 훨씬 간단합니다.

---

## 안전

- 모든 표에 RLS(행 수준 보안)가 걸려 있어 **주인 계정만** 읽고 쓸 수 있습니다
- anon 키는 공개돼도 됩니다. RLS가 막아주기 때문에 로그인 없이는 아무것도 읽히지 않습니다
- `service_role` 키를 넣으면 배포가 실패하도록 막아뒀습니다
- 수집 시크릿이 담긴 표는 정책이 하나도 없어 REST로는 아예 접근되지 않습니다
- 지운 로그는 휴지통에 3일 머물다 자동으로 사라집니다

---

## 파일

| 파일 | 하는 일 |
|---|---|
| `index.html` | 대문 |
| `shelf.html` | 도서관 · 리더 |
| `chars.html` | 캐릭터 · 폴더 |
| `import.html` | 로그 추가 |
| `settings.html` | 테마 · 글꼴 · 태그 · 상태창 · 플러그인 · 백업 |
| `trash.html` | 휴지통 |
| `parse.js` | 로그 파일 해석 |
| `theme.js` | 테마 · 글꼴 |
| `setup.sql` | Supabase 설치용 SQL |
| `build.js` | 배포할 때 `config.js`를 굽는 스크립트 |
| `log_sender.js` | 리수 플러그인 |
| `config.js` | 내 Supabase 정보 (배포 시 자동 생성) |

---

## 만든 것

본문 글꼴로 [리디바탕](https://ridicorp.com/story/ridibatang/)(리디주식회사)을 씁니다.
