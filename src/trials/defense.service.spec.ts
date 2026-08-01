import { isDefenseClosed } from './defense.service';
import { type JurorVote } from './verdict.service';

const jury = (g: JurorVote, i: JurorVote, b: JurorVote, f: JurorVote) => [
  { juror: '가성비요정', emoji: '🐿️', vote: g, argument: '' },
  { juror: '텅장지킴이', emoji: '🧘', vote: i, argument: '' },
  { juror: '지름요정', emoji: '🔥', vote: b, argument: '' },
  { juror: '팩트봇', emoji: '🔮', vote: f, argument: '' },
];
const G: JurorVote = 'GUILTY';
const N: JurorVote = 'NOT_GUILTY';

const tie = jury(N, G, N, G); // 2:2
const decisive = jury(G, G, G, N); // 3:1

describe('isDefenseClosed (기본 3R, 2:2 동점이면 최대 5R까지 연장)', () => {
  it('기본 라운드(1~2)는 결과와 무관하게 진행', () => {
    expect(isDefenseClosed(1, tie)).toBe(false);
    expect(isDefenseClosed(2, decisive)).toBe(false);
  });

  it('3R에서 판정이 명확하면 종료', () => {
    expect(isDefenseClosed(3, decisive)).toBe(true);
  });

  it('3R에서 2:2 동점이면 종료하지 않고 연장', () => {
    expect(isDefenseClosed(3, tie)).toBe(false);
    expect(isDefenseClosed(4, tie)).toBe(false);
  });

  it('연장 중 타이가 깨지면 즉시 종료', () => {
    expect(isDefenseClosed(4, decisive)).toBe(true);
  });

  it('5R 하드캡: 동점이어도 종료', () => {
    expect(isDefenseClosed(5, tie)).toBe(true);
  });
});
