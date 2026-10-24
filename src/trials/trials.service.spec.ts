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

describe('deleteComment 권한', () => {
  const comment = { trialId: 't1', userId: 'writer', trial: { userId: 'owner' } };
  const make = () => {
    const prisma = {
      trialComment: { findUnique: jest.fn().mockResolvedValue(comment), delete: jest.fn() },
      trial: { update: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    return { prisma, svc: new TrialsService(prisma as any, {} as any, {} as any, {} as any) };
  };

  it('작성자·판례 주인은 삭제 가능', async () => {
    for (const userId of ['writer', 'owner']) {
      const { prisma, svc } = make();
      await expect(svc.deleteComment('t1', 'c1', userId)).resolves.toEqual({ id: 'c1' });
      expect(prisma.$transaction).toHaveBeenCalled();
    }
  });

  it('제3자는 거절, 다른 판례 id로는 찾을 수 없음', async () => {
    const { prisma, svc } = make();
    await expect(svc.deleteComment('t1', 'c1', 'stranger')).rejects.toThrow('삭제할 수 있습니다');
    await expect(svc.deleteComment('t2', 'c1', 'owner')).rejects.toThrow('찾을 수 없습니다');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
