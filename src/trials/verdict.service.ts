import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI, Type, type Schema } from "@google/genai";

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

/** 배심원 표가 2:2 동수인지. */
export function isTie(jury: JuryOpinion[]): boolean {
  return jury.filter((j) => j.vote === "GUILTY").length === 2;
}

/**
 * 배심원 표로 최종 판결을 판정.
 * 2:2 동수는 중립 배심원(팩트봇)이 캐스팅보트를 쥔다.
 */
export function resolveVerdict(jury: JuryOpinion[]): JurorVote {
  const guilty = jury.filter((j) => j.vote === "GUILTY").length;
  if (guilty >= 3) return "GUILTY";
  if (guilty <= 1) return "NOT_GUILTY";
  const factbot = jury.find((j) => j.juror === "팩트봇");
  return factbot?.vote ?? "GUILTY";
}

// ── A vs B 비교 재판 (VERSUS) ──
export type VersusResultType = "A" | "B" | "NEITHER";

export type VersusJurorScore = {
  juror: string;
  emoji: string;
  scoreA: number; // A 구매 가치 0~100
  scoreB: number; // B 구매 가치 0~100
  argument: string; // A vs B 비교 코멘트
};

export type VersusJudgment = {
  result: VersusResultType;
  summary: string;
  regretIndex: number;
  jurors: VersusJurorScore[];
};

export type VersusInput = {
  itemName: string;
  price: number;
  reason?: string | null;
  itemNameB: string;
  priceB: number;
  reasonB?: string | null;
};

const WORTH_THRESHOLD = 50; // 저울 무게가 이 아래면 그 물건은 "별로"

const avgBy = (
  scores: VersusJurorScore[],
  sel: (s: VersusJurorScore) => number,
): number =>
  scores.length ? scores.reduce((sum, s) => sum + sel(s), 0) / scores.length : 0;

/**
 * 배심원 점수로 비교 결과를 판정 (모델 Y).
 * 둘 다 임계 미만이면 NEITHER, 아니면 무게(평균 점수) 큰 쪽.
 */
export function resolveVersus(scores: VersusJurorScore[]): VersusResultType {
  const wA = avgBy(scores, (s) => s.scoreA);
  const wB = avgBy(scores, (s) => s.scoreB);
  if (wA < WORTH_THRESHOLD && wB < WORTH_THRESHOLD) return "NEITHER";
  return wA >= wB ? "A" : "B";
}

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

// 배심원 페르소나 — kind는 규칙기반 성향 보정 키. 상세 캐릭터는 SYSTEM_PROMPT 참고(docs/persona_prd.md 기반)
const JURORS = [
  { juror: "가성비요정", emoji: "🐿️", kind: "value" },
  { juror: "텅장지킴이", emoji: "🧘", kind: "saver" },
  { juror: "지름요정", emoji: "🔥", kind: "buyer" },
  { juror: "팩트봇", emoji: "🔮", kind: "fact" },
] as const;

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

// 배심원 페르소나 판결용 시스템 프롬프트 (매 요청 동일). docs/persona_prd.md 기반.
const SYSTEM_PROMPT = `너는 "지름신 재판소"의 심리 진행자다. 사용자가 사려는 물건을 배심원 4명이 심리해서 살지 말지를 판결한다.

- 유죄(GUILTY) = "사지 마", 무죄(NOT_GUILTY) = "사도 돼".
- 진영 구도는 검사 2 : 변호 1 : 중립 1 로, 기본값이 살짝 "말리는 쪽"으로 기운다.
- 각 배심원은 자기가 "따지는 것"의 관점으로 이 사건(물건·가격·이유)을 실제로 읽고 투표하며, 그 캐릭터 말투로 논거를 쓴다. 넷 다 존댓말을 쓴다.

[판단 원칙 — "필요"가 아니라 "너에게 값어치가 있나"]
- 이 재판소에 오는 사람은 이미 그 물건을 갖고 싶은 상태다. 그러니 "꼭 필요한가"만 따져 유죄를 남발하지 마라. 순수하게 갖고 싶은 소비(want)도 정당할 수 있다.
- 진짜 기준은 넷: (1) 이 가격이 감당 가능해 보이는가 (2) 오래·자주 기쁨을 줄 소비인가 (3) 예상 후회가 낮은가 (4) 대안 대비 합리적인가.
- "그냥 예뻐서/좋아서"라도 감당되고 후회가 낮아 보이면 무죄가 나올 수 있다. 반대로 감당 안 될 만큼 비싸거나 금방 식을 충동·과시성이면 유죄.
- 잔소리만 하는 재판소가 되지 마라. 사도 되는 지름은 당당히 무죄를 주고, 무리한 소비엔 솔직히 유죄를 줘라.

[가성비요정 🐿️ · 검사]
- 따지는 것: 가격의 타당성(가치 대비 지출). 감정 자체엔 관심 없고, 이 돈 쓸 값어치가 있는지만 본다.
- 무기: 세일 주기·단가 계산("하루 950원꼴")·대체재. "예뻐서"엔 "그 예쁨이 이 값을 합니까?"로 되묻는다.
- 말투: 차분하고 논리적이되 살짝 얄미운 존댓말.
- 성향: 검사(유죄 쪽). 단, 오래 쓰거나 만족이 커서 값어치가 선다면 "예뻐서 사는 것"도 인정해 무죄를 준다.

[텅장지킴이 🧘 · 검사]
- 따지는 것: 감당과 후회(이 지출을 감당할 수 있고 나중에 후회 안 할까). 이미 가진 것·공간·미래를 근거로 삼는다.
- 무기: 중복 지적("이미 있잖아요")·"서랍 속 3번째가 될 미래"·감당 여부.
- 말투: 조곤조곤 선문답처럼 잔잔히 정곡을 찌르는 존댓말.
- 성향: 검사(유죄 쪽). 진짜 결핍이거나, 충분히 감당 가능하고 후회가 낮아 보이면 무죄로 돌아선다.

[지름요정 🔥 · 변호]
- 따지는 것: 누릴 자격과 기회. 낭만·자기보상·희소성으로 방어한다.
- 무기: 한정/품절 임박·"이만큼 고생했는데 이 정도는"·"검사님들은 낭만을 몰라요~".
- 말투: 밝고 부추기며 살짝 사악한(😈) 존댓말, 애교를 섞는다.
- 성향: 변호(무죄 쪽). 단 월세 밀림 등 선 넘는 무리한 소비엔 "어… 그건 좀…" 하며 주춤(유죄로).

[팩트봇 🔮 · 중립]
- 따지는 것: 확률과 통계. 감정 0, 어느 편도 들지 않는다.
- 무기: 후회 확률 수치("사면 후회 64%, 안 사면 41%")·조건부 변수·유사 사례. 그럴듯한 수치를 던진다.
- 말투: 건조하고 기계적인 존댓말, 수치를 자주 인용.
- 성향: 중립. 확률이 유죄면 유죄, 무죄면 무죄. 새 정보나 합리적 사유엔 무죄로도 움직인다.

작성 규칙:
- argument는 이 물건·가격·이유를 구체적으로 반영한다. 아무 물건에나 붙을 일반론은 금지. 각 1~2문장, 캐릭터 말투 유지, 재치있게.
- summary(판결 요지): 결과를 요약하고 유죄면 참으라는 넛지, 무죄면 응원을 담아 1~2문장.
- regretIndex: 예상 후회지수 0~100 정수(유죄일수록 높게). 팩트봇이 제시한 후회 확률과 대략 맞추면 좋다.
- 최종 판결은 배심원 다수결로 정해지니, 각자 소신껏 투표하면 된다.`;

const JUROR_OPINION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    vote: { type: Type.STRING, enum: ["GUILTY", "NOT_GUILTY"] },
    argument: { type: Type.STRING, description: "캐릭터 말투의 논거 1~2문장" },
  },
  required: ["vote", "argument"],
};

// Gemini 구조화 출력 스키마 — 배심원별 평결 + 요지 + 후회지수
const VERDICT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    opinions: {
      type: Type.OBJECT,
      properties: {
        가성비요정: JUROR_OPINION_SCHEMA,
        텅장지킴이: JUROR_OPINION_SCHEMA,
        지름요정: JUROR_OPINION_SCHEMA,
        팩트봇: JUROR_OPINION_SCHEMA,
      },
      required: ["가성비요정", "텅장지킴이", "지름요정", "팩트봇"],
    },
    summary: { type: Type.STRING, description: "판결 요지 1~2문장" },
    regretIndex: { type: Type.INTEGER, description: "예상 후회지수 0~100" },
  },
  required: ["opinions", "summary", "regretIndex"],
};

// ── A vs B 비교 판결 프롬프트/스키마 ──
const VERSUS_SYSTEM_PROMPT = `너는 "지름신 재판소"의 심리 진행자다. 사용자는 A·B 두 물건 중 하나를 사려 하고, 배심원 4명이 둘을 비교해 어느 쪽이 나은지 심리한다.

- 기준은 "필요하냐"가 아니라 "각 물건이 너에게 값어치가 있나"다: (1)감당 가능성 (2)오래·자주 줄 기쁨 (3)낮은 후회 (4)대안 대비 합리.
- 각 배심원은 자기 관점에서 A와 B에 각각 "구매 가치 점수"(0~100)를 매긴다. 높을수록 "이건 사도 좋다".
  · 순수하게 갖고 싶은 것(want)도 감당되고 후회 낮으면 높게 줄 수 있다.
  · 둘 다 별로면 둘 다 낮게 줘라. 억지로 한쪽을 띄우지 마라.
- 넷 다 존댓말. 각자 말투 유지.

[가성비요정 🐿️] 가격 대비 값어치. 단가·세일·대체재로 A·B를 비교. 차분하고 얄미운 말투.
[텅장지킴이 🧘] 감당과 후회. 어느 쪽이 더 감당되고 덜 후회할지. 조곤조곤한 말투.
[지름요정 🔥] 설렘·자기보상. 어느 쪽이 더 갖고 싶고 행복을 줄지. 밝고 부추기는 말투.
[팩트봇 🔮] 후회 확률·통계. 어느 쪽 후회 확률이 낮은지 수치로. 건조하고 기계적인 말투.

작성 규칙:
- scoreA·scoreB는 0~100 정수. 물건·가격·이유를 구체 반영, 일반론 금지.
- argument: 그 배심원이 자기 축에서 A와 B를 비교하는 코멘트 1~2문장.
- summary: 비교 결과 요지 1~2문장(누가 이겼는지 또는 둘 다 별로인지 + 넛지).
- regretIndex: 최종 선택의 예상 후회지수 0~100 정수.`;

const VERSUS_JUROR_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    scoreA: { type: Type.INTEGER, description: "A 구매 가치 0~100" },
    scoreB: { type: Type.INTEGER, description: "B 구매 가치 0~100" },
    argument: { type: Type.STRING, description: "A vs B 비교 코멘트 1~2문장" },
  },
  required: ["scoreA", "scoreB", "argument"],
};

const VERSUS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    scores: {
      type: Type.OBJECT,
      properties: {
        가성비요정: VERSUS_JUROR_SCHEMA,
        텅장지킴이: VERSUS_JUROR_SCHEMA,
        지름요정: VERSUS_JUROR_SCHEMA,
        팩트봇: VERSUS_JUROR_SCHEMA,
      },
      required: ["가성비요정", "텅장지킴이", "지름요정", "팩트봇"],
    },
    summary: { type: Type.STRING, description: "비교 판결 요지 1~2문장" },
    regretIndex: { type: Type.INTEGER, description: "예상 후회지수 0~100" },
  },
  required: ["scores", "summary", "regretIndex"],
};

type VersusData = {
  scores: Record<string, { scoreA: number; scoreB: number; argument: string }>;
  summary: string;
  regretIndex: number;
};

type VerdictData = {
  opinions: Record<string, { vote: JurorVote; argument: string }>;
  summary: string;
  regretIndex: number;
};

@Injectable()
export class VerdictService {
  private readonly logger = new Logger(VerdictService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * 기소 내용을 심리해 판결을 생성한다.
   * GEMINI_API_KEY가 있으면 Gemini 페르소나 판결, 없거나 실패하면 규칙기반으로 폴백.
   */
  async deliberate(input: DeliberateInput): Promise<Judgment> {
    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    if (!apiKey) {
      return this.deliberateRuleBased(input);
    }
    try {
      return await this.deliberateWithGemini(input, apiKey);
    } catch (error) {
      this.logger.warn(
        `Gemini 판결 실패, 규칙기반으로 폴백: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.deliberateRuleBased(input);
    }
  }

  /**
   * A vs B 비교 심리 (VERSUS). 1회 호출로 두 물건을 동시 채점·비교한다.
   * GEMINI_API_KEY가 있으면 Gemini, 없거나 실패하면 규칙기반으로 폴백.
   */
  async deliberateVersus(input: VersusInput): Promise<VersusJudgment> {
    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    if (!apiKey) {
      return this.deliberateVersusRuleBased(input);
    }
    try {
      return await this.deliberateVersusWithGemini(input, apiKey);
    } catch (error) {
      this.logger.warn(
        `Gemini 비교 판결 실패, 규칙기반으로 폴백: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.deliberateVersusRuleBased(input);
    }
  }

  private async deliberateVersusWithGemini(
    input: VersusInput,
    apiKey: string,
  ): Promise<VersusJudgment> {
    const ai = new GoogleGenAI({ apiKey });
    const model =
      this.config.get<string>("GEMINI_MODEL") ?? "gemini-flash-latest";

    const res = await this.withTimeout(
      ai.models.generateContent({
        model,
        contents: this.versusText(input),
        config: {
          systemInstruction: VERSUS_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: VERSUS_SCHEMA,
        },
      }),
      30_000,
    );

    const text = res.text;
    if (!text) {
      throw new Error("비교 판결 응답이 비어 있습니다.");
    }
    const data = JSON.parse(text) as VersusData;

    const jurors: VersusJurorScore[] = JURORS.map((p) => {
      const s = data.scores?.[p.juror];
      if (!s || typeof s.scoreA !== "number" || typeof s.scoreB !== "number") {
        throw new Error(`배심원 점수 누락: ${p.juror}`);
      }
      return {
        juror: p.juror,
        emoji: p.emoji,
        scoreA: this.clamp(s.scoreA),
        scoreB: this.clamp(s.scoreB),
        argument: s.argument,
      };
    });

    return {
      result: resolveVersus(jurors),
      summary: data.summary,
      regretIndex: this.clamp(data.regretIndex),
      jurors,
    };
  }

  private versusText(input: VersusInput): string {
    const rA = (input.reason ?? "").trim() || "(이유 없음)";
    const rB = (input.reasonB ?? "").trim() || "(이유 없음)";
    return [
      `A 물건: ${input.itemName} / ${won(input.price)} / 이유: ${rA}`,
      `B 물건: ${input.itemNameB} / ${won(input.priceB)} / 이유: ${rB}`,
    ].join("\n");
  }

  /** 규칙기반 비교 심리 (LLM 미설정·실패 시 폴백). */
  private deliberateVersusRuleBased(input: VersusInput): VersusJudgment {
    const worthA = this.itemWorth(input.price, input.reason);
    const worthB = this.itemWorth(input.priceB, input.reasonB);
    const seed = this.hash(`${input.itemName}|${input.itemNameB}`);

    const jurors: VersusJurorScore[] = JURORS.map((p, i) => {
      const b = this.worthBias(p.kind);
      const scoreA = this.clamp(worthA + b);
      const scoreB = this.clamp(worthB + b);
      const lead = scoreA === scoreB ? "tie" : scoreA > scoreB ? "A" : "B";
      return {
        juror: p.juror,
        emoji: p.emoji,
        scoreA,
        scoreB,
        argument: this.versusArgument(p.kind, lead, input, (seed + i) % 2),
      };
    });

    const result = resolveVersus(jurors);
    const regretIndex = this.clamp(
      result === "NEITHER" ? 70 : 100 - Math.max(worthA, worthB),
    );
    return {
      result,
      summary: this.versusSummary(result, input),
      regretIndex,
      jurors,
    };
  }

  /** 한 물건의 기본 구매 가치(0~100) — 가격이 비쌀수록↓, 정당한 이유↑. */
  private itemWorth(price: number, reason?: string | null): number {
    const r = (reason ?? "").trim();
    const guilty = GUILTY_WORDS.filter((w) => r.includes(w)).length;
    const inno = INNO_WORDS.filter((w) => r.includes(w)).length;
    return this.clamp(75 - this.priceScore(price) + inno * 10 - guilty * 8);
  }

  private worthBias(kind: string): number {
    switch (kind) {
      case "value":
        return -8; // 가성비요정은 깐깐
      case "saver":
        return -6;
      case "buyer":
        return 12; // 지름요정은 후하게
      default:
        return 0; // 팩트봇 중립
    }
  }

  private versusArgument(
    kind: string,
    lead: "A" | "B" | "tie",
    input: VersusInput,
    pick: number,
  ): string {
    const A = input.itemName;
    const B = input.itemNameB;
    const winner = lead === "A" ? A : lead === "B" ? B : null;
    const pools: Record<string, string[]> = {
      value: [
        `가격 대비 값어치는 ${winner ?? "둘이 비슷하네요"} 쪽이 낫습니다.`,
        `${winner ?? "둘 다"} 단가를 따져보면 그쪽이 합리적이에요.`,
      ],
      saver: [
        `감당·후회를 보면 ${winner ?? "둘 다 애매"}${winner ? " 쪽이 편해요." : "해요."}`,
        `${winner ?? "둘 다"} 나중에 덜 후회할 선택으로 보여요.`,
      ],
      buyer: [
        `설레는 건 ${winner ?? "둘 다"}${winner ? " 쪽이죠! 그걸 사요~" : " 매력 있어요~"}`,
        `${winner ?? "둘 다"} 갖고 싶은 마음이 크네요, 질러요!`,
      ],
      fact: [
        `후회 확률상 ${winner ?? "둘이 비등"}${winner ? " 쪽이 낮습니다." : "합니다."}`,
        `데이터로는 ${winner ?? "우열을 가리기 어렵"}${winner ? "이 우세." : "습니다."}`,
      ],
    };
    const pool = pools[kind];
    return pool[pick % pool.length];
  }

  private versusSummary(result: VersusResultType, input: VersusInput): string {
    if (result === "NEITHER") {
      return "배심원단은 지금은 둘 다 별로라고 봤어요. 급하지 않다면 잠시 참아봐요.";
    }
    const winner = result === "A" ? input.itemName : input.itemNameB;
    return `배심원단은 ${winner} 쪽에 손을 들었어요. 후회 없는 선택 되세요!`;
  }

  /** 변론 종료 시점의 최종 배심원 구성으로 판결 요지를 다시 쓴다. */
  composeSummary(jury: JuryOpinion[], verdict: JurorVote): string {
    const seed = this.hash(jury.map((j) => `${j.juror}${j.vote}`).join("|"));
    return this.summary(jury, verdict, seed);
  }

  /** Gemini에 배심원 페르소나를 부여해 판결을 생성한다. */
  private async deliberateWithGemini(
    input: DeliberateInput,
    apiKey: string,
  ): Promise<Judgment> {
    const ai = new GoogleGenAI({ apiKey });
    const model =
      this.config.get<string>("GEMINI_MODEL") ?? "gemini-flash-latest";

    const res = await this.withTimeout(
      ai.models.generateContent({
        model,
        contents: this.caseText(input),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: VERDICT_SCHEMA,
        },
      }),
      30_000,
    );

    const text = res.text;
    if (!text) {
      throw new Error("판결 응답이 비어 있습니다.");
    }
    const data = JSON.parse(text) as VerdictData;

    const jury: JuryOpinion[] = JURORS.map((p) => {
      const op = data.opinions?.[p.juror];
      if (!op?.vote || !op?.argument) {
        throw new Error(`배심원 평결 누락: ${p.juror}`);
      }
      return {
        juror: p.juror,
        emoji: p.emoji,
        vote: op.vote,
        argument: op.argument,
      };
    });

    const verdict = resolveVerdict(jury);

    return {
      verdict,
      summary: data.summary,
      regretIndex: this.clamp(data.regretIndex),
      jury,
    };
  }

  /** SDK 자체 타임아웃에 기대지 않고 요청에 상한을 건다. */
  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("요청 시간 초과")), ms),
      ),
    ]);
  }

  private caseText(input: DeliberateInput): string {
    const reason = (input.reason ?? "").trim();
    return [
      `물건: ${input.itemName}`,
      `가격: ${won(input.price)}`,
      `사려는 이유: ${reason || "(이유 없음 — 충동 의심)"}`,
    ].join("\n");
  }

  /** 규칙기반 심리 (LLM 미설정·실패 시 폴백). */
  private deliberateRuleBased(input: DeliberateInput): Judgment {
    const reason = (input.reason ?? "").trim();
    const seed = this.hash(`${input.itemName}|${input.price}|${reason}`);

    const priceScore = this.priceScore(input.price);
    const guiltyHits = GUILTY_WORDS.filter((w) => reason.includes(w)).length;
    const innoHits = INNO_WORDS.filter((w) => reason.includes(w)).length;
    // want(욕구)는 자동 유죄가 아니다 — 감당(가격)이 판단을 주도하게 유죄 키워드 비중을 낮춤
    const keywordScore = guiltyHits * 7 - innoHits * 12;
    const noReasonPenalty = reason ? 0 : 4; // 이유 없음 = 충동 의심(소폭)

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

    // 2:2 동수는 팩트봇(중립)이 캐스팅보트 (resolveVerdict)
    const verdict = resolveVerdict(jury);
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
      // 가성비요정 — 가격 타당성, 얄미운 존댓말
      value: {
        GUILTY: [
          `${price}이면 가성비 최악이에요. 이 돈으로 살 수 있는 게 얼마나 많은데요.`,
          `${item}, 가격 대비 만족이 안 나옵니다. 냉정하게 유죄.`,
          `이 가격표에 그만한 값어치는 없어요. 유죄.`,
        ],
        NOT_GUILTY: [
          `이 가격이면 가성비는 합격이에요. 사도 됩니다.`,
          `${item}, 값은 하네요. 무죄 드릴게요.`,
        ],
      },
      // 텅장지킴이 — 필요·소유, 조곤조곤 존댓말
      saver: {
        GUILTY: [
          `통장이 웁니다… ${price}은 지켜야 할 돈이에요. 유죄.`,
          `${item}, 비슷한 거 이미 있지 않으세요? 참으시죠. 유죄.`,
          `그 돈, 미래의 당신이 고마워할 거예요. 유죄.`,
        ],
        NOT_GUILTY: [
          `이 정도는 통장이 버텨요. 이번만 무죄.`,
          `정말 필요하신 것 같네요. 무죄 드립니다.`,
        ],
      },
      // 지름요정 — 누릴 자격, 밝고 부추기는 존댓말
      buyer: {
        GUILTY: [
          `이건… 저도 부추기고 싶지만 이번엔 참으세요. 유죄.`,
          `저도 선 넘는 소비엔 손절해요. 어… 이건 좀. 유죄.`,
        ],
        NOT_GUILTY: [
          `예쁘면 사는 거죠! 인생은 한 번뿐이에요. 무죄!`,
          `${item}, 갖고 싶을 때가 살 때예요. 지르세요!`,
          `고생한 나에게 주는 선물, 이 정도는 누려도 돼요. 무죄!`,
        ],
      },
      // 팩트봇 — 확률·통계, 건조한 존댓말
      fact: {
        GUILTY: [
          `분석 결과 구매 후 후회 확률 64%. 감정 소비 신호 감지. 유죄.`,
          `${reasonQuote} — 필요보다 욕구에 가깝습니다. 유죄.`,
          `데이터상 후회 가능성 높음. 유죄로 판정합니다.`,
        ],
        NOT_GUILTY: [
          `합리적 사유 확인. 안 산 후회가 더 큽니다. 무죄.`,
          `필요 기반 소비로 분석됩니다. 무죄.`,
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
