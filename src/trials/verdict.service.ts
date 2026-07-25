import { Injectable } from "@nestjs/common";

export type JurorVote = "GUILTY" | "NOT_GUILTY";

export type JuryOpinion = {
  juror: string;
  emoji: string;
  vote: JurorVote;
  argument: string;
};

export type Judgment = {
  verdict: JurorVote; // 다수결 최종 판결
  summary: string; // 판결 요지
  regretIndex: number; // 예상 후회지수 0~100
  jury: JuryOpinion[]; // 배심원 4명 평결
};

export type DeliberateInput = {
  itemName: string;
  price: number;
  reason?: string | null;
};

// 사려는 이유에서 감지하는 신호 키워드
const GUILTY_WORDS = [
  "예뻐",
  "예쁘",
  "이뻐",
  "신형",
  "신상",
  "한정",
  "색깔",
  "색상",
  "충동",
  "그냥",
  "갖고",
  "세일",
  "할인",
  "남들",
  "유행",
  "홧김",
  "기분",
  "스트레스",
  "플렉스",
  "지름",
  "보상",
  "질러",
];
const INNO_WORDS = [
  "필요",
  "고장",
  "망가",
  "부서",
  "대체",
  "업무",
  "일하",
  "공부",
  "학습",
  "건강",
  "매일",
  "자주",
  "오래",
  "없어서",
  "없어",
  "수리",
  "대신",
  "수업",
  "운동",
  "이사",
];

// 배심원 페르소나 — bias는 baseGuilt(0~100)에 더해지는 성향 보정
const JURORS = [
  { juror: "가성비요정", emoji: "🐿️", kind: "value" },
  { juror: "텅장지킴이", emoji: "🧘", kind: "saver" },
  { juror: "지름요정", emoji: "🔥", kind: "buyer" },
  { juror: "팩트봇", emoji: "🔮", kind: "fact" },
] as const;

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

@Injectable()
export class VerdictService {
  /** 기소 내용을 규칙기반으로 심리해 판결을 생성한다. */
  deliberate(input: DeliberateInput): Judgment {
    const reason = (input.reason ?? "").trim();
    const seed = this.hash(`${input.itemName}|${input.price}|${reason}`);

    const priceScore = this.priceScore(input.price);
    const guiltyHits = GUILTY_WORDS.filter((w) => reason.includes(w)).length;
    const innoHits = INNO_WORDS.filter((w) => reason.includes(w)).length;
    const keywordScore = guiltyHits * 10 - innoHits * 12;
    const noReasonPenalty = reason ? 0 : 6; // 이유 없음 = 충동 의심

    const baseGuilt = this.clamp(priceScore + keywordScore + noReasonPenalty);

    const jury: JuryOpinion[] = JURORS.map((p) => {
      const adjusted = this.clamp(
        baseGuilt + this.bias(p.kind, priceScore, keywordScore),
      );
      const vote: JurorVote = adjusted >= 50 ? "GUILTY" : "NOT_GUILTY";
      return {
        juror: p.juror,
        emoji: p.emoji,
        vote,
        argument: this.argument(p.kind, vote, input, reason, seed),
      };
    });

    const guiltyCount = jury.filter((j) => j.vote === "GUILTY").length;
    // 2:2 동수는 유죄 (재판소 기본값 — 신중하게)
    const verdict: JurorVote = guiltyCount >= 2 ? "GUILTY" : "NOT_GUILTY";
    const regretIndex = this.clamp(
      verdict === "GUILTY" ? Math.max(baseGuilt, 52) : Math.min(baseGuilt, 40),
    );

    return {
      verdict,
      summary: this.summary(jury, verdict, seed),
      regretIndex,
      jury,
    };
  }

  private priceScore(price: number): number {
    if (price >= 500000) return 40;
    if (price >= 200000) return 28;
    if (price >= 100000) return 18;
    if (price >= 50000) return 10;
    return 2;
  }

  private bias(kind: string, priceScore: number, keywordScore: number): number {
    switch (kind) {
      case "value": // 가격 대비 가치 — 비쌀수록 유죄
        return priceScore - 15;
      case "saver": // 절약파 — 늘 유죄 성향
        return 16;
      case "buyer": // 지름 옹호 — 늘 무죄 성향
        return -22;
      case "fact": // 논리파 — 이유의 합리성에 좌우, 가격엔 둔감
        return keywordScore - Math.round(priceScore * 0.3);
      default:
        return 0;
    }
  }

  private argument(
    kind: string,
    vote: JurorVote,
    input: DeliberateInput,
    reason: string,
    seed: number,
  ): string {
    const item = input.itemName;
    const price = won(input.price);
    const reasonQuote = reason ? `"${reason}"` : "이유도 없이 지르려는 것";

    const pools: Record<string, Record<JurorVote, string[]>> = {
      value: {
        GUILTY: [
          `${price}이면 가성비 최악이야. 이 돈으로 살 수 있는 게 얼마나 많은데.`,
          `${item}, 가격 대비 만족이 안 나와. 냉정하게 유죄.`,
          `이 가격표에 그만한 값어치는 없어. 유죄.`,
        ],
        NOT_GUILTY: [
          `이 가격이면 가성비는 합격이야. 사도 돼.`,
          `${item}, 값은 하네. 무죄 줄게.`,
        ],
      },
      saver: {
        GUILTY: [
          `통장이 운다… ${price}은 지켜야 할 돈이야. 유죄.`,
          `이번 달도 텅장인데 ${item}이라니. 참자, 유죄.`,
          `그 돈, 미래의 네가 고마워할 거야. 유죄.`,
        ],
        NOT_GUILTY: [
          `이 정도는 통장이 버텨. 이번만 무죄.`,
          `아껴 온 보상이라 치자. 무죄.`,
        ],
      },
      buyer: {
        GUILTY: [
          `이건 나도 못 말려… 이번엔 참아. 유죄.`,
          `지름요정도 손절할 때가 있지. 유죄.`,
        ],
        NOT_GUILTY: [
          `예쁘면 사는 거지! 인생은 한 번뿐. 무죄!`,
          `${item}, 갖고 싶을 때가 살 때야. 질러!`,
          `행복은 통장에 안 남아. 무죄!`,
        ],
      },
      fact: {
        GUILTY: [
          `감정 소비 신호 감지됨. 구매 정당성 부족. 유죄.`,
          `${reasonQuote} — 필요보다 욕구에 가까움. 유죄.`,
          `데이터상 후회 확률 높음. 유죄 판정.`,
        ],
        NOT_GUILTY: [
          `합리적 사유 확인됨. 구매 타당. 무죄.`,
          `필요 기반 소비로 분석됨. 무죄.`,
        ],
      },
    };

    const pool = pools[kind][vote];
    return pool[seed % pool.length];
  }

  private summary(
    jury: JuryOpinion[],
    verdict: JurorVote,
    seed: number,
  ): string {
    const guilty = jury.filter((j) => j.vote === "GUILTY").map((j) => j.juror);
    const inno = jury
      .filter((j) => j.vote === "NOT_GUILTY")
      .map((j) => j.juror);

    if (verdict === "GUILTY") {
      const who =
        inno.length === 0
          ? "배심원 만장일치로 유죄예요."
          : `${guilty.join("·")}이 유죄에 손들었어요. ${inno.join("·")}만 끝까지 변호했고요.`;
      const nudges = [
        "정 갖고 싶으면 딱 2주만 참아보세요. 그때도 생각나면, 그건 진짜예요.",
        "지금의 설렘이 2주 뒤엔 어떨지 한 번만 상상해보세요.",
        "장바구니에 담아두고 다음 주에 다시 봐요. 그때 판단해도 늦지 않아요.",
      ];
      return `${who} ${nudges[seed % nudges.length]}`;
    }

    const who =
      guilty.length === 0
        ? "배심원 만장일치로 무죄예요."
        : `${inno.join("·")}이 무죄에 손들었어요. ${guilty.join("·")}은 끝까지 말렸지만요.`;
    const nudges = [
      "배심원단도 인정했어요. 후회 없이 질러도 좋아요.",
      "필요한 소비로 봤어요. 기분 좋게 데려오세요.",
      "이건 지름이 아니라 투자예요. 축하해요!",
    ];
    return `${who} ${nudges[seed % nudges.length]}`;
  }

  private clamp(n: number): number {
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  private hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }
}
