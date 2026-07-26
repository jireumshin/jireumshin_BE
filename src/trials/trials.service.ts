import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTrialDto } from "./dto/create-trial.dto";
import { VerdictService } from "./verdict.service";

@Injectable()
export class TrialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verdict: VerdictService,
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

    const judgment = this.verdict.deliberate({
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
      },
    });
  }
}
