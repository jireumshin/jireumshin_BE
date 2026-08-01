import { Module } from '@nestjs/common';
import { TrialsController } from './trials.controller';
import { TrialsService } from './trials.service';
import { VerdictService } from './verdict.service';
import { DefenseService } from './defense.service';
import { FollowUpReminderService } from './follow-up-reminder.service';

@Module({
  controllers: [TrialsController],
  providers: [
    TrialsService,
    VerdictService,
    DefenseService,
    FollowUpReminderService,
  ],
})
export class TrialsModule {}
