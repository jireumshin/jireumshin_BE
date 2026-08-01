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
import { VerdictService } from "./verdict.service";

@Injectable()
export class TrialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verdict: VerdictService,
    private readonly config: ConfigService,
  ) {}

  create(dto: CreateTrialDto, userId?: string) {
    return this.prisma.trial.create({ data: { ...dto, userId } });
  }

  /** 로그인 유저 본인이 기소한 판례 목록 (최신순) */
  findMine(userId: string) {
    return this.prisma.trial.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string) {
    const trial = await this.prisma.trial.findUnique({ where: { id } });
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
}
