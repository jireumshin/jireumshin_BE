import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateTrialDto } from './dto/create-trial.dto';
import { TrialsService } from './trials.service';

@ApiTags('trials')
@Controller('trials')
export class TrialsController {
  constructor(private readonly trialsService: TrialsService) {}

  @Post()
  @ApiOperation({ summary: '기소 접수 (새 사건 생성)' })
  create(@Body() dto: CreateTrialDto) {
    return this.trialsService.create(dto);
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
