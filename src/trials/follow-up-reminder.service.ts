import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const BATCH_LIMIT = 100;

@Injectable()
export class FollowUpReminderService {
  private readonly logger = new Logger(FollowUpReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  // 매일 오전 10시(KST) 재질문 시점이 지난 미발송 판례에 알림 메일 발송
  @Cron(CronExpression.EVERY_DAY_AT_10AM, { timeZone: 'Asia/Seoul' })
  handleDailyReminders() {
    return this.sendDueReminders();
  }

  // 재질문 대상: 판결났고, 재질문 시점 지났고, 아직 미응답·미발송이며, 이메일이 있는 유저의 판례
  findDueForReminder(limit = BATCH_LIMIT) {
    return this.prisma.trial.findMany({
      where: {
        status: 'JUDGED',
        followUpDueAt: { lte: new Date() },
        followedUpAt: null,
        followUpNotifiedAt: null,
        user: { email: { not: null } },
      },
      include: { user: { select: { email: true, nickname: true } } },
      orderBy: { followUpDueAt: 'asc' },
      take: limit,
    });
  }

  /** 발송 후 성공한 건만 followUpNotifiedAt 마킹(실패는 다음 실행에 재시도). 발송 건수 반환. */
  async sendDueReminders(): Promise<number> {
    const targets = await this.findDueForReminder();
    if (targets.length === 0) return 0;

    let sent = 0;
    for (const trial of targets) {
      const email = trial.user?.email;
      if (!email) continue;

      const ok = await this.mail.send(
        email,
        '⏰ 그때 그 지름, 지금도 생각나세요?',
        this.buildHtml(trial.user?.nickname ?? '', trial.itemName),
      );
      if (!ok) continue;

      await this.prisma.trial.update({
        where: { id: trial.id },
        data: { followUpNotifiedAt: new Date() },
      });
      sent += 1;
    }

    this.logger.log(`후회 재질문 메일 ${sent}/${targets.length}건 발송`);
    return sent;
  }

  private buildHtml(nickname: string, itemName: string): string {
    const url = `${this.config.get<string>('APP_URL') ?? ''}/records`;
    const who = nickname ? `${nickname}님, ` : '';
    return `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>⚖️ 지름신 재판소</h2>
        <p>${who}그때 재판했던 <b>${itemName}</b>, 지금 돌아보면 어떠세요?</p>
        <p>결국 샀는지, 후회하는지 딱 두 번만 눌러 알려주세요.</p>
        <p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#8B6CFF;color:#fff;border-radius:10px;text-decoration:none;font-weight:700">후회 여부 알려주기 →</a></p>
      </div>`;
  }
}
