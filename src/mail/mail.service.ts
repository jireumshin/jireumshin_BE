import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 465);

    this.from =
      this.config.get<string>('MAIL_FROM') ||
      `지름신 재판소 <${user ?? 'noreply@jireumshin.shop'}>`;

    if (!host || !user || !pass) {
      this.transporter = null;
      this.logger.warn(
        'SMTP 설정이 없어 메일을 발송하지 않습니다. 개발 환경에서는 링크를 로그로 출력합니다.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  /** 발송 실패를 호출측으로 전파하지 않는다 (계정 존재 노출·요청 실패 방지) */
  async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      return true;
    } catch (error) {
      this.logger.error(
        `메일 발송 실패 (${to}): ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }
}
