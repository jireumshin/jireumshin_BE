import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { isTie } from "./verdict.service";
import type { JurorVote, JuryOpinion } from "./verdict.service";

// 변론 게임 규칙 — 판결 후 사용자가 배심원을 설득해 표를 뒤집는다
export const BASE_DEFENSE_ROUNDS = 3; // 기본 라운드
export const MAX_DEFENSE_ROUNDS = 5; // 2:2 동점이면 최대 여기까지 연장
export const GAUGE_THRESHOLD = 50; // 이상이면 무죄(사도 됨)로 전향

/**
 * 변론 종료 여부. 기본 3라운드로 끝내되, 2:2 동점이면 최대 5라운드까지 연장.
 * round는 방금 끝낸 라운드 번호(1부터).
 */
export function isDefenseClosed(round: number, jury: JuryOpinion[]): boolean {
  return (
    round >= MAX_DEFENSE_ROUNDS ||
    (round >= BASE_DEFENSE_ROUNDS && !isTie(jury))
  );
}
const GAUGE_MIN_DELTA = -30;
const GAUGE_MAX_DELTA = 30;
const INITIAL_GAUGE: Record<JurorVote, number> = {
  GUILTY: 35, // 유죄 배심원은 임계 아래에서 출발
  NOT_GUILTY: 65, // 무죄 배심원은 임계 위에서 출발
};

const JURORS = [
  { juror: "가성비요정", emoji: "🐿️", kind: "value" },
  { juror: "텅장지킴이", emoji: "🧘", kind: "saver" },
  { juror: "지름요정", emoji: "🔥", kind: "buyer" },
  { juror: "팩트봇", emoji: "🔮", kind: "fact" },
] as const;

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export type DefenseInput = {
  itemName: string;
  price: number;
  reason?: string | null;
  gauges: Record<string, number>; // 현재 배심원별 게이지 0~100
  message: string; // 피고인의 변론
};

export type JurorReaction = {
  juror: string;
  emoji: string;
  reply: string; // 캐릭터 말투 반응 1~2문장
  gaugeDelta: number; // 게이지 변화량 (-30~30)
};

const DEFENSE_SYSTEM_PROMPT = `너는 "지름신 재판소"의 심리 진행자다. 이미 1차 판결이 났고, 지금은 피고인(사용자)이 배심원 4명에게 추가로 진술하는 단계다.

- 이건 "배심원을 이겨서 판결을 뒤집는" 말싸움이 아니다. 1차 판결 때 미처 못 밝힌 속사정을 더 솔직히 털어놓는 "추가 진술"이다.
- 각 배심원에겐 0~100 게이지가 있다. 높을수록 무죄(사도 됨) 쪽. gaugeDelta(-30~30 정수)는 "이 진술로 이 사람의 상황을 더 이해하게 됐고, 그래서 판단이 이만큼 움직였다"는 뜻이다.
- 움직이는 건 오직 "새로운 진짜 맥락"일 때다: 감당 가능하다는 근거(모아둔 돈·예산 안·이 정도는 여유), 오래·자주 쓸 거란 사실, 몰랐던 용도, 진짜 필요. 이게 나오면 해당 배심원은 크게 움직이고 판결이 정당하게 뒤집힐 수 있다.
- 반대로 새 맥락 없는 단순 반복·떼쓰기("그래도 갖고 싶어요")는 이해를 늘리지 못하니 0(이성 배심원). 없는 사실을 지어내 억지 쓰면 신뢰를 잃어 음수. 원래 사유가 부실했는데 새 근거 없이 말만 바꾼 것도 좋아지면 안 된다 — 유지하거나 낮춰라.
- 각 배심원은 자기가 "마음이 움직이는 지점"에 맞는 진술에만 크게 반응한다. 같은 말이 모두에게 통하진 않는다.

[가성비요정 🐿️ · 검사]
- 움직이는 지점: 구체적 숫자·계산·단가·세일·대체재, 오래 쓴다는 근거. ("하루 900원꼴", "5년 쓸 거예요")
- 안 통함: 근거 없는 순수 감정("그냥 갖고 싶어요")엔 0.
- 말투: 차분하고 얄미운 존댓말.

[텅장지킴이 🧘 · 검사]
- 움직이는 지점: 감당 가능하다는 근거(모아둔 돈·예산 여유)나 진짜 결핍(고장·대체 불가·정말 없어서).
- 안 통함: 감당 근거 없는 단순 소유 정당화("두 개면 안 되나요")엔 0.
- 말투: 조곤조곤 선문답 같은 존댓말.

[지름요정 🔥 · 변호]
- 움직이는 지점: 감정적 명분(고생·자기보상·낭만·힐링)에 크게 +. 원래부터 무죄 쪽이라 잘 편든다.
- 주춤(-): 월세 밀림·빚·카드값 등 무리한 소비를 실토하면 "어… 그건 좀…" 하며 내려감.
- 말투: 밝고 부추기며 살짝 사악한(😈) 존댓말.

[팩트봇 🔮 · 중립]
- 움직이는 지점: 모델에 없던 "새로운 정보/용도"(부업·매일 사용·투자 등)에 크게 ± 움직인다.
- 안 통함: 근거 없는 감정 호소엔 0. 새 정보가 오히려 부정적이면 음수.
- 말투: 건조하고 기계적인 존댓말, 수치를 인용.

작성 규칙:
- reply: 각 배심원이 이번 진술에 대해 캐릭터 말투로 1~2문장 반응. 이해가 됐으면 인정하는 티를, 아니면 재치있게 되묻는다.
- gaugeDelta: -30~30 정수. 새 진짜 맥락에 정확히 꽂혔으면 크게(+15~30), 그럭저럭이면 +5~12, 새 맥락 없으면 0, 억지·무리한 소비 실토면 음수.
- 진술 내용을 구체적으로 반영한다. 아무 데나 붙을 일반론 금지.`;

const REACTION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING, description: "캐릭터 말투 반응 1~2문장" },
    gaugeDelta: {
      type: Type.INTEGER,
      description: "게이지 변화량 -30~30 (새 맥락으로 이해되면 +, 억지·무근거면 0 이하)",
    },
  },
  required: ["reply", "gaugeDelta"],
};

const DEFENSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    reactions: {
      type: Type.OBJECT,
      properties: {
        가성비요정: REACTION_SCHEMA,
        텅장지킴이: REACTION_SCHEMA,
        지름요정: REACTION_SCHEMA,
        팩트봇: REACTION_SCHEMA,
      },
      required: ["가성비요정", "텅장지킴이", "지름요정", "팩트봇"],
    },
  },
  required: ["reactions"],
};

type DefenseData = {
  reactions: Record<string, { reply: string; gaugeDelta: number }>;
};

@Injectable()
export class DefenseService {
  private readonly logger = new Logger(DefenseService.name);

  constructor(private readonly config: ConfigService) {}

  /** 판결 직후 배심원 게이지 초기값 — 각자의 표에서 파생. */
  static initialGauges(jury: JuryOpinion[]): Record<string, number> {
    return Object.fromEntries(
      jury.map((j) => [j.juror, INITIAL_GAUGE[j.vote]]),
    );
  }

  /** 게이지로 배심원 표를 판정. */
  static voteFromGauge(gauge: number): JurorVote {
    return gauge >= GAUGE_THRESHOLD ? "NOT_GUILTY" : "GUILTY";
  }

  /**
   * 변론을 심리해 배심원별 반응·게이지 변화량을 만든다.
   * GEMINI_API_KEY가 있으면 Gemini, 없거나 실패하면 규칙기반으로 폴백.
   */
  async evaluate(input: DefenseInput): Promise<JurorReaction[]> {
    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    if (!apiKey) {
      return this.evaluateRuleBased(input);
    }
    try {
      return await this.evaluateWithGemini(input, apiKey);
    } catch (error) {
      this.logger.warn(
        `Gemini 변론 심리 실패, 규칙기반으로 폴백: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.evaluateRuleBased(input);
    }
  }

  private async evaluateWithGemini(
    input: DefenseInput,
    apiKey: string,
  ): Promise<JurorReaction[]> {
    const ai = new GoogleGenAI({ apiKey });
    const model =
      this.config.get<string>("GEMINI_MODEL") ?? "gemini-flash-latest";

    const res = await this.withTimeout(
      ai.models.generateContent({
        model,
        contents: this.caseText(input),
        config: {
          systemInstruction: DEFENSE_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: DEFENSE_SCHEMA,
        },
      }),
      30_000,
    );

    const text = res.text;
    if (!text) {
      throw new Error("변론 응답이 비어 있습니다.");
    }
    const data = JSON.parse(text) as DefenseData;

    return JURORS.map((p) => {
      const r = data.reactions?.[p.juror];
      if (!r?.reply || typeof r.gaugeDelta !== "number") {
        throw new Error(`배심원 반응 누락: ${p.juror}`);
      }
      return {
        juror: p.juror,
        emoji: p.emoji,
        reply: r.reply,
        gaugeDelta: this.clampDelta(r.gaugeDelta),
      };
    });
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("요청 시간 초과")), ms),
      ),
    ]);
  }

  private caseText(input: DefenseInput): string {
    const reason = (input.reason ?? "").trim();
    const gaugeLine = JURORS.map(
      (p) => `${p.juror} ${Math.round(input.gauges[p.juror] ?? 50)}`,
    ).join(", ");
    return [
      `물건: ${input.itemName}`,
      `가격: ${won(input.price)}`,
      `사려는 이유: ${reason || "(이유 없음)"}`,
      `현재 배심원 게이지(높을수록 무죄): ${gaugeLine}`,
      `피고인 변론: "${input.message.trim()}"`,
    ].join("\n");
  }

  /** 규칙기반 변론 심리 (LLM 미설정·실패 시 폴백). */
  private evaluateRuleBased(input: DefenseInput): JurorReaction[] {
    const msg = input.message;
    const seed = this.hash(msg);

    const hasNumbers = /[0-9]|하루|한달|매달|개월|[0-9]년|시간당|단가|원어치/.test(
      msg,
    );
    const hasNeed = /고장|망가|부서|없어서|없어졌|꼭 필요|대체 불가|수리|낡아|닳/.test(
      msg,
    );
    const hasEmotion = /고생|스트레스|힘들|지쳐|지침|보상|선물|힐링|위로|우울/.test(
      msg,
    );
    const hasOverspend = /월세|빚|대출|밀렸|카드값|할부|무리|굶|텅장/.test(msg);
    const hasNewInfo = /부업|업무|일하|투자|매일|공부|수업|운동|자격증|프로젝트/.test(
      msg,
    );

    const deltas: Record<string, number> = {
      가성비요정: hasNumbers ? 18 : hasNewInfo ? 8 : 0,
      텅장지킴이: hasNeed ? 20 : hasOverspend ? -8 : 0,
      지름요정: hasOverspend ? -12 : hasEmotion ? 18 : 0,
      팩트봇: hasNewInfo ? 16 : hasOverspend ? -10 : hasNumbers ? 8 : 0,
    };

    return JURORS.map((p) => {
      const delta = this.clampDelta(deltas[p.juror]);
      return {
        juror: p.juror,
        emoji: p.emoji,
        reply: this.ruleReply(p.kind, delta, seed),
        gaugeDelta: delta,
      };
    });
  }

  private ruleReply(kind: string, delta: number, seed: number): string {
    const persuaded = delta > 0;
    const pools: Record<string, Record<"up" | "down", string[]>> = {
      value: {
        up: [
          "계산이 서네요. 그 정도면 단가는 납득이 됩니다.",
          "숫자로 나오니 인정할 수밖에요. 조금 마음이 움직이네요.",
        ],
        down: [
          "그건 감정이지 계산이 아니에요. 값어치 근거를 주세요.",
          "여전히 이 가격을 정당화할 숫자가 안 보입니다.",
        ],
      },
      saver: {
        up: [
          "정말 없어서 필요한 거라면… 이야기가 다르네요.",
          "그건 욕망이 아니라 결핍이군요. 조금 수긍합니다.",
        ],
        down: [
          "이미 있는 걸 또 사려는 이유론 약해요.",
          "그건 필요가 아니라 갖고 싶은 마음 아닐까요.",
        ],
      },
      buyer: {
        up: [
          "그렇죠! 그렇게 고생했으면 이 정도는 누려야죠~😈",
          "낭만을 아는 변론이에요! 저는 완전 무죄 쪽이에요~",
        ],
        down: [
          "어… 그건 좀. 무리하면서까지는 저도 못 부추기겠어요.",
          "사고 싶지만 그 상황엔 저도 멈칫하게 되네요…",
        ],
      },
      fact: {
        up: [
          "그 변수는 모델에 없던 정보네요. 확률을 다시 계산합니다.",
          "새 정보 반영 결과, 후회 확률이 유의미하게 내려갑니다.",
        ],
        down: [
          "감정은 변수로 잡히지 않습니다. 데이터엔 변화 없음.",
          "새로운 정보가 없어 통계상 판단은 그대로입니다.",
        ],
      },
    };
    const pool = pools[kind][persuaded ? "up" : "down"];
    return pool[seed % pool.length];
  }

  private clampDelta(n: number): number {
    return Math.max(GAUGE_MIN_DELTA, Math.min(GAUGE_MAX_DELTA, Math.round(n)));
  }

  private hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }
}
