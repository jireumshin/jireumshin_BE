import { Module } from '@nestjs/common';
import { TrialsController } from './trials.controller';
import { TrialsService } from './trials.service';

@Module({
  controllers: [TrialsController],
  providers: [TrialsService],
})
export class TrialsModule {}
