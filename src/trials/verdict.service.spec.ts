import { resolveVerdict, isTie, type JurorVote } from './verdict.service';

// (가성비요정, 텅장지킴이, 지름요정, 팩트봇) 순서로 표를 세팅
const jury = (g: JurorVote, i: JurorVote, b: JurorVote, f: JurorVote) => [
  { juror: '가성비요정', emoji: '🐿️', vote: g, argument: '' },
  { juror: '텅장지킴이', emoji: '🧘', vote: i, argument: '' },
  { juror: '지름요정', emoji: '🔥', vote: b, argument: '' },
  { juror: '팩트봇', emoji: '🔮', vote: f, argument: '' },
];
const G: JurorVote = 'GUILTY';
const N: JurorVote = 'NOT_GUILTY';

describe('resolveVerdict', () => {
  it('다수결: 3표 이상 유죄면 유죄', () => {
    expect(resolveVerdict(jury(G, G, G, G))).toBe('GUILTY');
    expect(resolveVerdict(jury(G, G, G, N))).toBe('GUILTY');
  });

  it('다수결: 유죄 1표 이하면 무죄', () => {
    expect(resolveVerdict(jury(N, G, N, N))).toBe('NOT_GUILTY');
    expect(resolveVerdict(jury(N, N, N, N))).toBe('NOT_GUILTY');
  });

  it('2:2 동수는 중립 배심원(팩트봇)이 캐스팅보트', () => {
    // 팩트봇 유죄 → 유죄
    expect(resolveVerdict(jury(N, G, N, G))).toBe('GUILTY');
    // 팩트봇 무죄 → 무죄
    expect(resolveVerdict(jury(G, N, G, N))).toBe('NOT_GUILTY');
  });
});

describe('isTie', () => {
  it('유죄 2표면 동점', () => {
    expect(isTie(jury(N, G, N, G))).toBe(true);
  });
  it('유죄 2표가 아니면 동점 아님', () => {
    expect(isTie(jury(G, G, G, N))).toBe(false);
    expect(isTie(jury(N, N, N, N))).toBe(false);
  });
});
