import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CreateTrialDto } from './dto/create-trial.dto';
import { TrialsService } from './trials.service';

@ApiTags('trials')
@Controller('trials')
export class TrialsController {
  constructor(private readonly trialsService: TrialsService) {}

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: '기소 접수 (로그인 시 본인 판례로 연결)' })
  create(@Body() dto: CreateTrialDto, @Req() req: Request) {
    const userId = (req.user as { userId?: string } | undefined)?.userId;
    return this.trialsService.create(dto, userId);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '내 판례 목록 (최신순)' })
  findMine(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.trialsService.findMine(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: '사건 조회' })
  findOne(@Param('id') id: string) {
    return this.trialsService.findOne(id);
  }

  @Post(':id/verdict')
  @ApiOperation({ summary: '심리 실행 후 판결 (멱등)' })
  judge(@Param('id') id: string) {
    return this.trialsService.judge(id);
  }
}
