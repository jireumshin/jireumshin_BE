import { Module } from '@nestjs/common';
import { TrialsController } from './trials.controller';
import { TrialsService } from './trials.service';
import { VerdictService } from './verdict.service';

@Module({
  controllers: [TrialsController],
  providers: [TrialsService, VerdictService],
})
export class TrialsModule {}
