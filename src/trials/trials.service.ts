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
import { VerdictService, resolveVerdict } from "./verdict.service";
import type { JuryOpinion } from "./verdict.service";
import { DefenseService, isDefenseClosed } from "./defense.service";

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

  /** 심리 실행 후 판결 저장. 이미 판결난 사건은 그대로 반환. */
  async judge(id: string) {
    const trial = await this.findOne(id);
    if (trial.status === "JUDGED") {
      return trial;
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

  /** 판결 후 재질문이 열리는 시각. 지연은 env로 조정(기본 90일, 로컬 테스트는 0). */
  private followUpDueDate(): Date {
    const days = Number(this.config.get("FOLLOW_UP_DELAY_DAYS") ?? 90);
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

    const jury = (trial.jury as unknown as JuryOpinion[]) ?? [];
    if (jury.length === 0) {
      throw new BadRequestException("판결 정보가 없어 변론할 수 없습니다.");
    }

    const currentGauges =
      (trial.gauges as Record<string, number> | null) ??
      DefenseService.initialGauges(jury);

    const reactions = await this.defense.evaluate({
      itemName: trial.itemName,
      price: trial.price,
      reason: trial.reason,
      gauges: currentGauges,
      message: dto.message,
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

  private clampGauge(n: number): number {
    return Math.max(0, Math.min(100, Math.round(n)));
  }
}
