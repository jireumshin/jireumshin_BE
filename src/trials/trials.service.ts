import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTrialDto } from "./dto/create-trial.dto";
import { FollowUpDto } from "./dto/follow-up.dto";
import { DefenseDto } from "./dto/defense.dto";
import { VerdictService, resolveVerdict, resolveVersus } from "./verdict.service";
import type { JuryOpinion, VersusJurorScore } from "./verdict.service";
import {
  DefenseService,
  isDefenseClosed,
  BASE_DEFENSE_ROUNDS,
} from "./defense.service";

@Injectable()
export class TrialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verdict: VerdictService,
    private readonly defense: DefenseService,
    private readonly config: ConfigService,
  ) {}

  create(dto: CreateTrialDto, userId?: string) {
    return this.prisma.trial.create({ data: { ...dto, userId } });
  }

  /**
   * 익명(userId=null)으로 기소된 판례를 로그인 유저 본인에게 귀속.
   * 이미 본인 판례면 멱등 반환, 다른 사람 판례면 거절.
   */
  async claim(id: string, userId: string) {
    const trial = await this.findOne(id);
    if (trial.userId && trial.userId !== userId) {
      throw new ForbiddenException("이미 다른 사용자의 판례입니다.");
    }
    if (trial.userId === userId) {
      return trial;
    }
    return this.prisma.trial.update({
      where: { id },
      data: { userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }

  /** 로그인 유저 본인이 기소한 판례 목록 (최신순) */
  findMine(userId: string) {
    return this.prisma.trial.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string) {
    const trial = await this.prisma.trial.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!trial) {
      throw new NotFoundException("해당 사건을 찾을 수 없습니다.");
    }
    return trial;
  }

  /**
   * 사건 조회(뷰어 기준). 본인/익명(미소유) 판례는 전체를,
   * 타인의 공개 판례는 개인정보를 제거한 요약본을 반환한다. 타인의 비공개 판례는 404.
   */
  async viewForUser(id: string, viewerId?: string) {
    const trial = await this.findOne(id);
    const isOwner = !!viewerId && trial.userId === viewerId;
    // 익명(미소유) 판례는 id 자체가 열람 권한 → 기존처럼 전체 반환
    if (isOwner || trial.userId === null) return trial;
    // 타인의 판례: 공개된 것만, 그마저도 요약본으로
    if (!trial.isPublic) {
      throw new NotFoundException("해당 사건을 찾을 수 없습니다.");
    }
    const likedByMe = viewerId
      ? !!(await this.prisma.trialLike.findUnique({
          where: { trialId_userId: { trialId: id, userId: viewerId } },
        }))
      : false;
    return TrialsService.toPublicSummary(trial, likedByMe);
  }

  /**
   * 공유용 공개본 — 판결 화면은 소유자와 동일하게 보이되(기소 사유·배심원 평결 포함),
   * 개인정보·비공개 대화만 제거: 소유자 식별정보, 변론 채팅 로그, 변론 진행상태, 후회 응답.
   */
  private static toPublicSummary(
    trial: Awaited<ReturnType<TrialsService["findOne"]>>,
    likedByMe: boolean,
  ) {
    const {
      userId: _userId,
      messages: _messages,
      gauges: _gauges,
      gaugesB: _gaugesB,
      defenseRounds: _defenseRounds,
      defenseClosed: _defenseClosed,
      purchased: _purchased,
      regret: _regret,
      followedUpAt: _followedUpAt,
      followUpDueAt: _followUpDueAt,
      followUpNotifiedAt: _followUpNotifiedAt,
      ...visible
    } = trial;
    return { ...visible, likedByMe, isPublicView: true };
  }

  /** 심리 실행 후 판결 저장. 이미 판결난 사건은 그대로 반환. */
  async judge(id: string) {
    const trial = await this.findOne(id);
    if (trial.status === "JUDGED") {
      return trial;
    }
    if (trial.mode === "VERSUS") {
      return this.judgeVersus(trial);
    }

    const judgment = await this.verdict.deliberate({
      itemName: trial.itemName,
      price: trial.price,
      reason: trial.reason,
    });

    return this.prisma.trial.update({
      where: { id },
      data: {
        status: "JUDGED",
        verdict: judgment.verdict,
        summary: judgment.summary,
        regretIndex: judgment.regretIndex,
        jury: judgment.jury as unknown as Prisma.InputJsonValue,
        followUpDueAt: this.followUpDueDate(),
      },
    });
  }

  /** A vs B 비교 심리 후 결과 저장. jury=배심원 점수, gauges/gaugesB=A/B 무게. */
  private async judgeVersus(trial: { id: string } & Record<string, unknown>) {
    const judgment = await this.verdict.deliberateVersus({
      itemName: trial.itemName as string,
      price: trial.price as number,
      reason: trial.reason as string | null,
      itemNameB: (trial.itemNameB as string) ?? "",
      priceB: (trial.priceB as number) ?? 0,
      reasonB: trial.reasonB as string | null,
    });

    const gauges = Object.fromEntries(
      judgment.jurors.map((j) => [j.juror, j.scoreA]),
    );
    const gaugesB = Object.fromEntries(
      judgment.jurors.map((j) => [j.juror, j.scoreB]),
    );

    return this.prisma.trial.update({
      where: { id: trial.id },
      data: {
        status: "JUDGED",
        versusResult: judgment.result,
        summary: judgment.summary,
        regretIndex: judgment.regretIndex,
        jury: judgment.jurors as unknown as Prisma.InputJsonValue,
        gauges: gauges as unknown as Prisma.InputJsonValue,
        gaugesB: gaugesB as unknown as Prisma.InputJsonValue,
        followUpDueAt: this.followUpDueDate(),
      },
    });
  }

  /** 판결 후 재질문이 열리는 시각. 지연은 env로 조정(기본 3일, 로컬 테스트는 0). */
  private followUpDueDate(): Date {
    const days = Number(this.config.get("FOLLOW_UP_DELAY_DAYS") ?? 3);
    return new Date(Date.now() + days * 86_400_000);
  }

  /** 후회 재질문 응답 저장. 본인 판례의 판결난 사건만 가능. */
  async submitFollowUp(id: string, userId: string, dto: FollowUpDto) {
    const trial = await this.findOne(id);
    if (trial.userId !== userId) {
      throw new ForbiddenException("본인 판례만 응답할 수 있습니다.");
    }
    if (trial.status !== "JUDGED") {
      throw new BadRequestException("아직 판결 전인 사건입니다.");
    }
    return this.prisma.trial.update({
      where: { id },
      data: {
        purchased: dto.purchased,
        regret: dto.regret,
        followedUpAt: new Date(),
      },
    });
  }

  // ── 판례 탐색 피드 ──

  /** 피드에 노출할 판례 필드 (익명 — userId 등 소유자 정보 제외) */
  private static readonly FEED_SELECT = {
    id: true,
    itemName: true,
    price: true,
    reason: true,
    imageUrl: true,
    mode: true,
    verdict: true,
    summary: true,
    regretIndex: true,
    jury: true,
    itemNameB: true,
    priceB: true,
    reasonB: true,
    imageUrlB: true,
    versusResult: true,
    likeCount: true,
    publishedAt: true,
  } as const;

  /** 공개된 판례 피드 (최신 공개순, 커서 페이지네이션). userId 있으면 공감 여부 포함. */
  async feed(params: { cursor?: string; limit?: number; userId?: string }) {
    const take = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const trials = await this.prisma.trial.findMany({
      where: { isPublic: true, status: "JUDGED" },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: take + 1, // 다음 페이지 존재 여부 판별용 +1
      ...(params.cursor
        ? { cursor: { id: params.cursor }, skip: 1 }
        : {}),
      select: {
        ...TrialsService.FEED_SELECT,
        ...(params.userId
          ? { likes: { where: { userId: params.userId }, select: { id: true } } }
          : {}),
      },
    });

    const hasMore = trials.length > take;
    const page = hasMore ? trials.slice(0, take) : trials;
    const items = page.map((t) => {
      const { likes, ...rest } = t as typeof t & { likes?: unknown[] };
      return { ...rest, likedByMe: Array.isArray(likes) && likes.length > 0 };
    });
    return { items, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  /** 판례를 피드에 공개 (본인·판결난 사건만, 멱등). */
  async publish(id: string, userId: string) {
    const trial = await this.findOne(id);
    if (trial.userId !== userId) {
      throw new ForbiddenException("본인 판례만 공개할 수 있습니다.");
    }
    if (trial.status !== "JUDGED") {
      throw new BadRequestException("판결난 판례만 공개할 수 있습니다.");
    }
    if (trial.isPublic) return trial;
    return this.prisma.trial.update({
      where: { id },
      data: { isPublic: true, publishedAt: new Date() },
    });
  }

  /** 피드 공개 취소 (본인만). */
  async unpublish(id: string, userId: string) {
    const trial = await this.findOne(id);
    if (trial.userId !== userId) {
      throw new ForbiddenException("본인 판례만 비공개할 수 있습니다.");
    }
    return this.prisma.trial.update({
      where: { id },
      data: { isPublic: false, publishedAt: null },
    });
  }

  /** 공감 토글 (유저당 판례 1회). 반환: 현재 공감 상태·총 공감 수. */
  async toggleLike(id: string, userId: string) {
    const trial = await this.prisma.trial.findUnique({
      where: { id },
      select: { isPublic: true },
    });
    if (!trial) throw new NotFoundException("해당 사건을 찾을 수 없습니다.");
    if (!trial.isPublic) {
      throw new BadRequestException("공개되지 않은 판례입니다.");
    }

    const existing = await this.prisma.trialLike.findUnique({
      where: { trialId_userId: { trialId: id, userId } },
    });

    const [, updated] = await this.prisma.$transaction([
      existing
        ? this.prisma.trialLike.delete({ where: { id: existing.id } })
        : this.prisma.trialLike.create({ data: { trialId: id, userId } }),
      this.prisma.trial.update({
        where: { id },
        data: { likeCount: { [existing ? "decrement" : "increment"]: 1 } },
        select: { likeCount: true },
      }),
    ]);

    return { liked: !existing, likeCount: updated.likeCount };
  }

  /**
   * 배심원 변론(설득) 한 라운드. 판결난 사건에서만, 라운드가 남아 있을 때만 가능.
   * 게이지를 갱신해 표를 재판정하고, 다수결로 판결을 다시 계산한다.
   */
  async defend(id: string, dto: DefenseDto) {
    const trial = await this.findOne(id);
    if (trial.status !== "JUDGED") {
      throw new BadRequestException("아직 판결 전인 사건입니다.");
    }
    if (trial.defenseClosed) {
      throw new BadRequestException("이미 변론이 종료된 사건입니다.");
    }
    if (trial.mode === "VERSUS") {
      return this.defendVersus(trial, dto);
    }

    const jury = (trial.jury as unknown as JuryOpinion[]) ?? [];
    if (jury.length === 0) {
      throw new BadRequestException("판결 정보가 없어 변론할 수 없습니다.");
    }

    const currentGauges =
      (trial.gauges as Record<string, number> | null) ??
      DefenseService.initialGauges(jury);

    const history = trial.messages
      .map((m) => (m.role === "USER" ? `피고인: ${m.content}` : `${m.juror}: ${m.content}`))
      .join("\n");

    const reactions = await this.defense.evaluate({
      itemName: trial.itemName,
      price: trial.price,
      reason: trial.reason,
      gauges: currentGauges,
      message: dto.message,
      history,
    });

    // 게이지 적용 + 배심원 표 재판정
    const gauges: Record<string, number> = { ...currentGauges };
    const reactionByJuror = new Map(reactions.map((r) => [r.juror, r]));
    const nextJury: JuryOpinion[] = jury.map((j) => {
      const delta = reactionByJuror.get(j.juror)?.gaugeDelta ?? 0;
      const gauge = this.clampGauge((gauges[j.juror] ?? 50) + delta);
      gauges[j.juror] = gauge;
      return { ...j, vote: DefenseService.voteFromGauge(gauge) };
    });

    // 2:2 동수는 팩트봇(중립)이 캐스팅보트
    const verdict = resolveVerdict(nextJury);

    // 기본 3라운드로 종료하되, 동점(2:2)이면 최대 5라운드까지 연장전
    const round = trial.defenseRounds + 1;
    const defenseClosed = isDefenseClosed(round, nextJury);

    await this.prisma.trialMessage.createMany({
      data: [
        { trialId: id, role: "USER", content: dto.message, round },
        ...reactions.map((r) => ({
          trialId: id,
          role: "JUROR" as const,
          juror: r.juror,
          emoji: r.emoji,
          content: r.reply,
          round,
        })),
      ],
    });

    return this.prisma.trial.update({
      where: { id },
      data: {
        jury: nextJury as unknown as Prisma.InputJsonValue,
        verdict,
        gauges: gauges as unknown as Prisma.InputJsonValue,
        defenseRounds: round,
        defenseClosed,
        // 변론이 끝나면 최종 배심원 구성에 맞춰 요지를 다시 쓴다 (1심 요지와의 불일치 방지)
        ...(defenseClosed
          ? { summary: this.verdict.composeSummary(nextJury, verdict) }
          : {}),
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }

  /** VERSUS 변론: 추가 진술 하나로 A·B 점수를 동시 재평가 후 저울 재판정. */
  private async defendVersus(
    trial: Awaited<ReturnType<TrialsService["findOne"]>>,
    dto: DefenseDto,
  ) {
    const jurors = (trial.jury as unknown as VersusJurorScore[]) ?? [];
    if (jurors.length === 0) {
      throw new BadRequestException("판결 정보가 없어 변론할 수 없습니다.");
    }

    const gaugesA =
      (trial.gauges as Record<string, number> | null) ??
      Object.fromEntries(jurors.map((j) => [j.juror, j.scoreA]));
    const gaugesB =
      (trial.gaugesB as Record<string, number> | null) ??
      Object.fromEntries(jurors.map((j) => [j.juror, j.scoreB]));

    const history = trial.messages
      .map((m) => (m.role === "USER" ? `피고인: ${m.content}` : `${m.juror}: ${m.content}`))
      .join("\n");

    const reactions = await this.defense.evaluateVersus({
      itemName: trial.itemName,
      price: trial.price,
      reason: trial.reason,
      itemNameB: trial.itemNameB ?? "",
      priceB: trial.priceB ?? 0,
      reasonB: trial.reasonB,
      gaugesA,
      gaugesB,
      message: dto.message,
      history,
    });

    const nextA: Record<string, number> = { ...gaugesA };
    const nextB: Record<string, number> = { ...gaugesB };
    const byJuror = new Map(reactions.map((r) => [r.juror, r]));
    const nextJurors: VersusJurorScore[] = jurors.map((j) => {
      const r = byJuror.get(j.juror);
      const scoreA = this.clampGauge(j.scoreA + (r?.deltaA ?? 0));
      const scoreB = this.clampGauge(j.scoreB + (r?.deltaB ?? 0));
      nextA[j.juror] = scoreA;
      nextB[j.juror] = scoreB;
      return { ...j, scoreA, scoreB };
    });

    const versusResult = resolveVersus(nextJurors);
    const round = trial.defenseRounds + 1;
    // ponytail: versus는 3라운드 고정. 박빙 연장전은 필요해지면 추가.
    const defenseClosed = round >= BASE_DEFENSE_ROUNDS;

    await this.prisma.trialMessage.createMany({
      data: [
        { trialId: trial.id, role: "USER", content: dto.message, round },
        ...reactions.map((r) => ({
          trialId: trial.id,
          role: "JUROR" as const,
          juror: r.juror,
          emoji: r.emoji,
          content: r.reply,
          round,
        })),
      ],
    });

    return this.prisma.trial.update({
      where: { id: trial.id },
      data: {
        jury: nextJurors as unknown as Prisma.InputJsonValue,
        versusResult,
        gauges: nextA as unknown as Prisma.InputJsonValue,
        gaugesB: nextB as unknown as Prisma.InputJsonValue,
        defenseRounds: round,
        defenseClosed,
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }

  private clampGauge(n: number): number {
    return Math.max(0, Math.min(100, Math.round(n)));
  }
}
