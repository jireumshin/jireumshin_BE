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
import {
  VerdictService,
  resolveVerdict,
  resolveVersus,
} from "./verdict.service";
import type { JuryOpinion, VersusJurorScore } from "./verdict.service";
import {
  DefenseService,
  isDefenseClosed,
  BASE_DEFENSE_ROUNDS,
} from "./defense.service";
import type { FinalizeResult } from "./defense.service";
import { avatarUrl } from "../options/avatars";

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
      include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
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
      include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
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
    // 공개는 opt-in이라 작성자 닉네임·캐릭터는 함께 노출 (id·이메일은 비노출)
    const author = await this.prisma.user.findUnique({
      where: { id: trial.userId },
      select: { nickname: true, avatar: true },
    });
    return {
      ...TrialsService.toPublicSummary(trial, likedByMe),
      authorNickname: author?.nickname ?? null,
      authorAvatarUrl: avatarUrl(
        this.config.get<string>("S3_PUBLIC_BASE_URL") ?? "",
        author?.avatar,
      ),
    };
  }

  /**
   * 공유용 공개본 — 판결 화면·변론 대화까지 소유자와 동일하게 보이되(작성자 닉네임은 viewForUser에서 추가),
   * 소유자 식별정보·후회 응답은 제거하고 주인이 숨긴 진술은 내용을 비운다.
   */
  private static toPublicSummary(
    trial: Awaited<ReturnType<TrialsService["findOne"]>>,
    likedByMe: boolean,
  ) {
    const {
      userId: _userId,
      messages,
      gauges: _gauges,
      gaugesB: _gaugesB,
      purchased: _purchased,
      regret: _regret,
      followedUpAt: _followedUpAt,
      followUpDueAt: _followUpDueAt,
      followUpNotifiedAt: _followUpNotifiedAt,
      ...visible
    } = trial;
    return {
      ...visible,
      messages: messages.map((m) => (m.hidden ? { ...m, content: null } : m)),
      likedByMe,
      isPublicView: true,
    };
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
    commentCount: true,
    defenseRounds: true,
    publishedAt: true,
    user: { select: { nickname: true, avatar: true } }, // 작성자 닉네임·캐릭터만 (id·이메일 비노출)
  } as const;

  /** 공개된 판례 피드 (최신 공개순, 커서 페이지네이션). userId 있으면 공감 여부 포함. */
  async feed(params: { cursor?: string; limit?: number; userId?: string }) {
    const take = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const trials = await this.prisma.trial.findMany({
      where: { isPublic: true, status: "JUDGED" },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: take + 1, // 다음 페이지 존재 여부 판별용 +1
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        ...TrialsService.FEED_SELECT,
        ...(params.userId
          ? {
              likes: { where: { userId: params.userId }, select: { id: true } },
            }
          : {}),
      },
    });

    const hasMore = trials.length > take;
    const page = hasMore ? trials.slice(0, take) : trials;
    const base = this.config.get<string>("S3_PUBLIC_BASE_URL") ?? "";
    const items = page.map((t) => {
      const { likes, user, ...rest } = t as typeof t & { likes?: unknown[] };
      return {
        ...rest,
        authorNickname: user?.nickname ?? null,
        authorAvatarUrl: avatarUrl(base, user?.avatar),
        likedByMe: Array.isArray(likes) && likes.length > 0,
      };
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
      include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
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
      include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
  }

  /** 공개본에서 변론 진술 하나를 숨기거나 다시 보이기 (본인만). 갱신된 사건 반환. */
  async setMessageHidden(
    id: string,
    messageId: string,
    userId: string,
    hidden: boolean,
  ) {
    const trial = await this.findOne(id);
    if (trial.userId !== userId) {
      throw new ForbiddenException("본인 판례의 진술만 숨길 수 있습니다.");
    }
    if (!trial.messages.some((m) => m.id === messageId)) {
      throw new NotFoundException("해당 진술을 찾을 수 없습니다.");
    }
    await this.prisma.trialMessage.update({
      where: { id: messageId },
      data: { hidden },
    });
    return this.findOne(id);
  }

  // ── 댓글 ──

  /** 댓글 목록 (작성순). 공개 판례는 누구나, 비공개면 주인만. 작성자 id는 내리지 않음. */
  async listComments(id: string, viewerId?: string) {
    const trial = await this.prisma.trial.findUnique({
      where: { id },
      select: { isPublic: true, userId: true },
    });
    const isOwner = !!viewerId && trial?.userId === viewerId;
    if (!trial || (!trial.isPublic && !isOwner)) {
      throw new NotFoundException("해당 사건을 찾을 수 없습니다.");
    }
    const comments = await this.prisma.trialComment.findMany({
      where: { trialId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200, // ponytail: 페이지네이션 없음, 판례당 댓글이 수백 개 넘으면 커서 페이지 추가
      include: { user: { select: { nickname: true, avatar: true } } },
    });
    return comments.map((c) => this.toCommentView(c, viewerId, isOwner));
  }

  /** 댓글 작성 (로그인·공개 판례만). */
  async createComment(id: string, userId: string, content: string) {
    const text = content.trim();
    if (!text) throw new BadRequestException("댓글을 입력해주세요.");
    const trial = await this.prisma.trial.findUnique({
      where: { id },
      select: { isPublic: true, userId: true },
    });
    if (!trial) throw new NotFoundException("해당 사건을 찾을 수 없습니다.");
    if (!trial.isPublic) {
      throw new BadRequestException("공개된 판례에만 댓글을 달 수 있습니다.");
    }
    const [comment] = await this.prisma.$transaction([
      this.prisma.trialComment.create({
        data: { trialId: id, userId, content: text },
        include: { user: { select: { nickname: true, avatar: true } } },
      }),
      this.prisma.trial.update({
        where: { id },
        data: { commentCount: { increment: 1 } },
      }),
    ]);
    return this.toCommentView(comment, userId, trial.userId === userId);
  }

  /** 댓글 삭제 — 작성자 본인 또는 판례 주인. */
  async deleteComment(id: string, commentId: string, userId: string) {
    const comment = await this.prisma.trialComment.findUnique({
      where: { id: commentId },
      select: { trialId: true, userId: true, trial: { select: { userId: true } } },
    });
    if (!comment || comment.trialId !== id) {
      throw new NotFoundException("해당 댓글을 찾을 수 없습니다.");
    }
    if (comment.userId !== userId && comment.trial.userId !== userId) {
      throw new ForbiddenException("본인 댓글이나 내 판례의 댓글만 삭제할 수 있습니다.");
    }
    await this.prisma.$transaction([
      this.prisma.trialComment.delete({ where: { id: commentId } }),
      this.prisma.trial.update({
        where: { id },
        data: { commentCount: { decrement: 1 } },
      }),
    ]);
    return { id: commentId };
  }

  private toCommentView(
    c: {
      id: string;
      userId: string;
      content: string;
      createdAt: Date;
      user: { nickname: string; avatar: string | null };
    },
    viewerId: string | undefined,
    viewerOwnsTrial: boolean,
  ) {
    const mine = !!viewerId && c.userId === viewerId;
    return {
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      authorNickname: c.user.nickname,
      authorAvatarUrl: avatarUrl(
        this.config.get<string>("S3_PUBLIC_BASE_URL") ?? "",
        c.user.avatar,
      ),
      mine,
      canDelete: mine || viewerOwnsTrial,
    };
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
      .map((m) =>
        m.role === "USER" ? `피고인: ${m.content}` : `${m.juror}: ${m.content}`,
      )
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
          // 실제 적용된(0~100 클램프 후) 변화량
          ...TrialsService.gaugeLog(currentGauges, gauges, r.juror),
        })),
      ],
    });

    // 변론 종료 시 대화 전체를 종합한 최종 판결문 (실패 시 null → 최근 반응·규칙기반 요지)
    const final = defenseClosed
      ? await this.defense.finalize({
          caseText: `물건: ${trial.itemName} / ${trial.price.toLocaleString("ko-KR")}원 / 이유: ${trial.reason ?? "(이유 없음)"}`,
          jurors: nextJury
            .map(
              (j) =>
                `${j.juror}: 1심 "${j.argument}" → 최종 ${j.vote === "GUILTY" ? "유죄" : "무죄"} (게이지 ${gauges[j.juror]})`,
            )
            .join("\n"),
          outcome: verdict === "GUILTY" ? "유죄(사지 마)" : "무죄(사도 됨)",
          history: TrialsService.historyWith(history, dto.message, reactions),
        })
      : null;

    return this.prisma.trial.update({
      where: { id },
      data: {
        jury: TrialsService.withFinal(
          nextJury,
          final,
        ) as unknown as Prisma.InputJsonValue,
        verdict,
        gauges: gauges as unknown as Prisma.InputJsonValue,
        defenseRounds: round,
        defenseClosed,
        // 판결이 뒤집힌 라운드·변론 종료 시 요지를 다시 쓴다 (그대로면 1심 요지 유지)
        ...(final
          ? { summary: final.summary, regretIndex: final.regretIndex }
          : defenseClosed || verdict !== trial.verdict
            ? { summary: this.verdict.composeSummary(nextJury, verdict) }
            : {}),
      },
      include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
  }

  /** 지난 대화 + 이번 라운드 (최종 판결문 입력용) */
  private static historyWith(
    history: string,
    message: string,
    reactions: { juror: string; reply: string }[],
  ): string {
    return [
      history,
      `피고인: ${message}`,
      ...reactions.map((r) => `${r.juror}: ${r.reply}`),
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** 최종 판결문이 있으면 배심원별 finalArgument를 붙인다 (1심 argument는 0라운드용으로 유지) */
  private static withFinal<T extends { juror: string }>(
    jury: T[],
    final: FinalizeResult | null,
  ): (T & { finalArgument?: string })[] {
    return final
      ? jury.map((j) => ({ ...j, finalArgument: final.opinions[j.juror] }))
      : jury;
  }

  /** 배심원 답변 메시지에 남길 이번 라운드 게이지 기록 (모르는 배심원이면 null) */
  private static gaugeLog(
    before: Record<string, number>,
    after: Record<string, number>,
    juror: string,
  ) {
    const now = after[juror];
    if (typeof now !== "number") return { gauge: null, gaugeDelta: null };
    return { gauge: now, gaugeDelta: now - (before[juror] ?? now) };
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
      .map((m) =>
        m.role === "USER" ? `피고인: ${m.content}` : `${m.juror}: ${m.content}`,
      )
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
        ...reactions.map((r) => {
          const logB = TrialsService.gaugeLog(gaugesB, nextB, r.juror);
          return {
            trialId: trial.id,
            role: "JUROR" as const,
            juror: r.juror,
            emoji: r.emoji,
            content: r.reply,
            round,
            ...TrialsService.gaugeLog(gaugesA, nextA, r.juror),
            gaugeB: logB.gauge,
            gaugeDeltaB: logB.gaugeDelta,
          };
        }),
      ],
    });

    const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
    const final = defenseClosed
      ? await this.defense.finalize({
          caseText: [
            `A 물건: ${trial.itemName} / ${won(trial.price)} / 이유: ${trial.reason ?? "(이유 없음)"}`,
            `B 물건: ${trial.itemNameB ?? ""} / ${won(trial.priceB ?? 0)} / 이유: ${trial.reasonB ?? "(이유 없음)"}`,
          ].join("\n"),
          jurors: nextJurors
            .map(
              (j) =>
                `${j.juror}: 1심 "${j.argument}" → 최종 점수 A${j.scoreA}/B${j.scoreB}`,
            )
            .join("\n"),
          outcome:
            versusResult === "A"
              ? `A(${trial.itemName}) 선택`
              : versusResult === "B"
                ? `B(${trial.itemNameB ?? ""}) 선택`
                : "둘 다 별로",
          history: TrialsService.historyWith(history, dto.message, reactions),
        })
      : null;

    return this.prisma.trial.update({
      where: { id: trial.id },
      data: {
        jury: TrialsService.withFinal(
          nextJurors,
          final,
        ) as unknown as Prisma.InputJsonValue,
        versusResult,
        gauges: nextA as unknown as Prisma.InputJsonValue,
        gaugesB: nextB as unknown as Prisma.InputJsonValue,
        defenseRounds: round,
        defenseClosed,
        // 승자가 바뀐 라운드엔 요지도 맞춰 다시 쓴다 (종료 시엔 최종 판결문)
        ...(final
          ? { summary: final.summary, regretIndex: final.regretIndex }
          : versusResult !== trial.versusResult
            ? {
                summary: this.verdict.versusSummary(versusResult, {
                  itemName: trial.itemName,
                  itemNameB: trial.itemNameB ?? "",
                }),
              }
            : {}),
      },
      include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
  }

  private clampGauge(n: number): number {
    return Math.max(0, Math.min(100, Math.round(n)));
  }
}
