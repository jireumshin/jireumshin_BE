import {
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { FollowUpReminderService } from './follow-up-reminder.service';

// Render 무료 인스턴스는 유휴 시 잠들어 @Cron이 돌지 않음 → GitHub Actions schedule이 호출
@ApiExcludeController()
@Controller('internal')
export class FollowUpReminderController {
  constructor(
    private readonly reminders: FollowUpReminderService,
    private readonly config: ConfigService,
  ) {}

  @Post('follow-up-reminders')
  @HttpCode(200)
  async run(@Headers('x-cron-secret') secret?: string) {
    const expected = this.config.get<string>('CRON_SECRET');
    if (!expected || !secret || !safeEqual(secret, expected)) {
      throw new UnauthorizedException();
    }
    return { sent: await this.reminders.sendDueReminders() };
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
