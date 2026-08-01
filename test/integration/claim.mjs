// 익명 판례 → 로그인 저장(claim) 흐름 통합 테스트 (실행 중 서버 필요)
const API = process.env.API_URL || 'http://localhost:4000';

const cookieOf = (res) =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

async function req(method, path, { cookie, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null), cookie: cookieOf(res) };
}
const uniq = () => Math.floor(Math.random() * 1e9);

export async function run() {
  let fail = 0;
  const ok = (c, label, extra = '') => {
    console.log(`  ${c ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
    if (!c) fail++;
  };
  console.log('\n[claim] 익명 판례 → 로그인 저장 흐름');

  const a = await req('POST', '/auth/signup', {
    body: { email: `a_${uniq()}@t.com`, nickname: `유저A${uniq()}`, password: 'test1234' },
  });
  const b = await req('POST', '/auth/signup', {
    body: { email: `b_${uniq()}@t.com`, nickname: `유저B${uniq()}`, password: 'test1234' },
  });
  ok(!!a.cookie && !!b.cookie, '테스트 유저 2명 가입 + 세션 쿠키');

  const anon = await req('POST', '/trials', {
    body: { itemName: 'claim 테스트', price: 30000, reason: '그냥' },
  });
  const tid = anon.json.id;
  ok(anon.json.userId === null, '익명 기소는 userId=null');

  ok((await req('POST', `/trials/${tid}/claim`)).status === 401, '무인증 claim → 401');

  const claimA = await req('POST', `/trials/${tid}/claim`, { cookie: a.cookie });
  ok(claimA.status === 201 && !!claimA.json.userId, '유저A claim → 소유 연결');

  ok(
    (await req('POST', `/trials/${tid}/claim`, { cookie: b.cookie })).status === 403,
    '유저B가 남의 판례 claim → 403(탈취 방지)',
  );

  ok(
    (await req('POST', `/trials/${tid}/claim`, { cookie: a.cookie })).status === 201,
    '유저A 재claim → 멱등 성공',
  );

  const mine = await req('GET', '/trials/mine', { cookie: a.cookie });
  ok(Array.isArray(mine.json) && mine.json.some((t) => t.id === tid), '/trials/mine 목록에 포함');

  return fail;
}
