import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CreateTrialDto } from './dto/create-trial.dto';
import { FollowUpDto } from './dto/follow-up.dto';
import { DefenseDto } from './dto/defense.dto';
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

  // 정적 경로는 :id 파라미터 경로보다 먼저 선언 (라우팅 충돌 방지)
  @Get('feed')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: '공개된 판례 피드 (최신순, 커서 페이지네이션)' })
  feed(
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = (req.user as { userId?: string } | undefined)?.userId;
    return this.trialsService.feed({
      cursor,
      limit: limit ? Number(limit) : undefined,
      userId,
    });
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: '사건 조회 (타인 공개 판례는 요약본)' })
  findOne(@Param('id') id: string, @Req() req: Request) {
    const userId = (req.user as { userId?: string } | undefined)?.userId;
    return this.trialsService.viewForUser(id, userId);
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '판례를 피드에 공개 (본인·판결난 사건)' })
  publish(@Param('id') id: string, @Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.trialsService.publish(id, userId);
  }

  @Delete(':id/publish')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '피드 공개 취소 (본인)' })
  unpublish(@Param('id') id: string, @Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.trialsService.unpublish(id, userId);
  }

  @Post(':id/like')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '공감 토글 (공개 판례)' })
  like(@Param('id') id: string, @Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.trialsService.toggleLike(id, userId);
  }

  @Post(':id/verdict')
  @ApiOperation({ summary: '심리 실행 후 판결 (멱등)' })
  judge(@Param('id') id: string) {
    return this.trialsService.judge(id);
  }

  @Post(':id/defense')
  @ApiOperation({ summary: '배심원 변론 한 라운드 (판결 후 설득)' })
  defend(@Param('id') id: string, @Body() dto: DefenseDto) {
    return this.trialsService.defend(id, dto);
  }

  @Post(':id/claim')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '익명으로 기소한 판례를 본인 판례로 저장(연결)' })
  claim(@Param('id') id: string, @Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.trialsService.claim(id, userId);
  }

  @Post(':id/follow-up')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '후회 재질문 응답 (본인 판례)' })
  followUp(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() dto: FollowUpDto,
  ) {
    const { userId } = req.user as { userId: string };
    return this.trialsService.submitFollowUp(id, userId, dto);
  }
}
