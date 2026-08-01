// 2:2 동점 연장전 라이브 재현 — DB에 동점 상태를 심고 실제 defense 엔드포인트로 검증
// (실행 중 서버 + DB 필요. dist 컴파일 함수로 응답 불변식 대조)
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { resolveVerdict } from '../../dist/trials/verdict.service.js';
import { isDefenseClosed } from '../../dist/trials/defense.service.js';

const API = process.env.API_URL || 'http://localhost:4000';

const tieJury = [
  { juror: '가성비요정', emoji: '🐿️', vote: 'NOT_GUILTY', argument: 'seed' },
  { juror: '텅장지킴이', emoji: '🧘', vote: 'GUILTY', argument: 'seed' },
  { juror: '지름요정', emoji: '🔥', vote: 'NOT_GUILTY', argument: 'seed' },
  { juror: '팩트봇', emoji: '🔮', vote: 'GUILTY', argument: 'seed' },
]; // 2:2, 팩트봇 유죄
const tieGauges = { 가성비요정: 60, 텅장지킴이: 40, 지름요정: 70, 팩트봇: 40 };
const decJury = tieJury.map((j) => (j.juror === '지름요정' ? { ...j, vote: 'GUILTY' } : j)); // 3:1

const post = async (id) => {
  const res = await fetch(`${API}/trials/${id}/defense`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '매일 업무에 쓰고 부업 투자로도 활용해요' }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

export async function run() {
  const prisma = new PrismaClient();
  let fail = 0;
  const ok = (c, label, extra = '') => {
    console.log(`  ${c ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
    if (!c) fail++;
  };
  const invariants = (r, label) => {
    ok(r.verdict === resolveVerdict(r.jury), `${label}: 판결=배심원표 일치`, `verdict=${r.verdict}`);
    ok(
      r.defenseClosed === isDefenseClosed(r.defenseRounds, r.jury),
      `${label}: 종료여부 규칙 일치`,
      `R${r.defenseRounds} closed=${r.defenseClosed}`,
    );
  };
  const seed = (over) =>
    prisma.trial.create({
      data: {
        itemName: '연장전 시드',
        price: 100000,
        status: 'JUDGED',
        verdict: 'GUILTY',
        summary: 'seed',
        regretIndex: 60,
        jury: tieJury,
        gauges: tieGauges,
        ...over,
      },
    });

  console.log('\n[extension] 2:2 동점 연장전 (DB 시드 → 실제 엔드포인트)');
  const created = [];
  try {
    // [A] 3R 동점 → 4R 변론이 실제로 열림(연장전 발동)
    const a = await seed({ defenseRounds: 3, defenseClosed: false });
    created.push(a.id);
    const ra = await post(a.id);
    ok(ra.status === 201, '3R 동점 → 4R 변론 허용(연장전 발동)', `status=${ra.status}`);
    if (ra.json) invariants(ra.json, 'R4');

    // [B] 3R 명확(3:1) → 종료로 4R 거부(연장은 동점에만)
    const b = await seed({ defenseRounds: 3, defenseClosed: true, jury: decJury });
    created.push(b.id);
    ok((await post(b.id)).status >= 400, '3R 명확 → 변론 종료(추가 변론 거부)');

    // [C] 4R 동점 → 5R 하드캡 종료 + 팩트봇 캐스팅보트
    const c = await seed({ defenseRounds: 4, defenseClosed: false });
    created.push(c.id);
    const rc = await post(c.id);
    ok(rc.status === 201, '4R 동점 → 5R 변론 허용', `status=${rc.status}`);
    if (rc.json) {
      ok(rc.json.defenseRounds === 5 && rc.json.defenseClosed === true, '5R 하드캡 종료');
      invariants(rc.json, 'R5');
    }
  } finally {
    if (created.length) await prisma.trial.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  }
  return fail;
}
