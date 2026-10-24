import { TrialsService } from './trials.service';

const toPublicSummary = (TrialsService as any).toPublicSummary;

describe('toPublicSummary', () => {
  const trial = {
    id: 't1',
    userId: 'owner',
    purchased: true,
    regret: false,
    defenseRounds: 2,
    defenseClosed: true,
    messages: [
      { id: 'm1', role: 'USER', content: '제 연봉이 5천이라', hidden: true },
      { id: 'm2', role: 'JUROR', content: '그래도 비싸요', hidden: false },
    ],
  };

  it('숨긴 진술은 내용을 비우고 나머지 대화는 공개', () => {
    const pub = toPublicSummary(trial, false);
    expect(pub.messages[0]).toMatchObject({ id: 'm1', content: null, hidden: true });
    expect(pub.messages[1].content).toBe('그래도 비싸요');
    expect(pub.defenseRounds).toBe(2);
    expect(pub.isPublicView).toBe(true);
  });

  it('소유자 식별정보·후회 응답은 제거', () => {
    const pub = toPublicSummary(trial, false);
    expect(pub).not.toHaveProperty('userId');
    expect(pub).not.toHaveProperty('purchased');
    expect(pub).not.toHaveProperty('regret');
  });
});
