// 이 파일을 config.js 로 복사한 뒤 자기 값으로 채우세요.
//
//   url : Supabase 대시보드 → Settings → Data API → Project URL
//   key : 같은 화면의 anon public 키
//
// anon 키는 공개돼도 됩니다. RLS(행 수준 보안)가 막아주기 때문에
// 로그인하지 않으면 아무 데이터도 읽히지 않습니다.
// 다만 service_role 키는 절대 여기에 넣지 마세요. RLS를 통째로 무시합니다.

export const CFG = {
  url: 'https://여기에프로젝트ID.supabase.co',
  key: '여기에_anon_public_키',
};
