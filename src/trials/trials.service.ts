import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrialDto } from './dto/create-trial.dto';

@Injectable()
export class TrialsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateTrialDto) {
    return this.prisma.trial.create({ data: dto });
  }

  async findOne(id: string) {
    const trial = await this.prisma.trial.findUnique({ where: { id } });
    if (!trial) {
      throw new NotFoundException('해당 사건을 찾을 수 없습니다.');
    }
    return trial;
  }
}
