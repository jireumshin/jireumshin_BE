import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { passwordResetEmail } from "../mail/templates/password-reset.template";
import { SignupDto } from "./dto/signup.dto";
import type { KakaoProfile } from "./kakao.service";

const SALT_ROUNDS = 10;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30분

// 비밀번호를 제외한 안전한 유저 정보
export type SafeUser = {
  id: string;
  email: string | null; // 카카오 유저는 이메일 동의를 거부할 수 있음
  nickname: string;
  provider: string;
  createdAt: Date;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async signup(dto: SignupDto): Promise<SafeUser> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { nickname: dto.nickname }] },
      select: { email: true, nickname: true },
    });
    if (existing) {
      const field = existing.email === dto.email ? "이메일" : "닉네임";
      throw new ConflictException(`이미 사용 중인 ${field}입니다.`);
    }

    const hashed = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        nickname: dto.nickname,
        password: hashed,
        provider: "LOCAL",
      },
    });
    return this.toSafeUser(user);
  }

  async validateUser(email: string, password: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (
      !user ||
      !user.password ||
      !(await bcrypt.compare(password, user.password))
    ) {
      throw new UnauthorizedException(
        "이메일 또는 비밀번호가 올바르지 않습니다.",
      );
    }
    return this.toSafeUser(user);
  }

  async me(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("사용자를 찾을 수 없습니다.");
    }
    return this.toSafeUser(user);
  }

  /** 닉네임 변경 — 본인 제외 중복 검사 후 갱신 */
  async updateNickname(userId: string, nickname: string): Promise<SafeUser> {
    const taken = await this.prisma.user.findFirst({
      where: { nickname, id: { not: userId } },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException("이미 사용 중인 닉네임입니다.");
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { nickname },
    });
    return this.toSafeUser(user);
  }

  /** JWT 발급 (쿠키에 담을 access token) */
  signToken(user: SafeUser): string {
    return this.jwt.sign({ sub: user.id, nickname: user.nickname });
  }

  async loginWithKakao(profile: KakaoProfile): Promise<SafeUser> {
    const linked = await this.prisma.user.findUnique({
      where: { providerId: profile.providerId },
    });
    if (linked) return this.toSafeUser(linked);

    if (profile.email && profile.emailVerified) {
      const byEmail = await this.prisma.user.findUnique({
        where: { email: profile.email },
      });
      if (byEmail) {
        const merged = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: { providerId: profile.providerId },
        });
        this.logger.log(`카카오 계정 연동: ${byEmail.id}`);
        return this.toSafeUser(merged);
      }
    }

    // 이메일이 미인증이거나 이미 다른 계정이 쓰는 중이면 저장하지 않는다 (unique 충돌 방지)
    let email: string | null = null;
    if (profile.email && profile.emailVerified) {
      const taken = await this.prisma.user.findUnique({
        where: { email: profile.email },
      });
      if (!taken) email = profile.email;
    }

    const created = await this.prisma.user.create({
      data: {
        email,
        nickname: await this.uniqueNickname(profile.nickname ?? "카카오판사"),
        provider: "KAKAO",
        providerId: profile.providerId,
      },
    });
    return this.toSafeUser(created);
  }

  /** 닉네임은 unique라 카카오 닉네임이 겹치면 숫자를 붙여 비켜간다 */
  private async uniqueNickname(base: string): Promise<string> {
    const trimmed = base.trim().slice(0, 12) || "카카오판사";
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? trimmed : `${trimmed}${i + 1}`;
      const exists = await this.prisma.user.findUnique({
        where: { nickname: candidate },
      });
      if (!exists) return candidate;
    }
    return `${trimmed}${crypto.randomBytes(3).toString("hex")}`;
  }

  /**
   * 비밀번호 재설정 요청 — 토큰을 생성해 해시로 저장하고 재설정 링크를 메일로 보낸다.
   * 계정 노출 방지를 위해 이메일 존재 여부·발송 성공 여부와 무관하게 성공 응답.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // 비밀번호가 있는 계정만 재설정 가능 (카카오 전용 계정은 비밀번호가 없음)
    if (!user || !user.password || !user.email) {
      return;
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const appUrl = (
      this.config.get<string>("APP_URL") || "http://localhost:3000"
    ).replace(/\/$/, "");
    const resetUrl = `${appUrl}/login/reset-password/?token=${rawToken}`;

    const sent = await this.mail.send(
      user.email,
      "[지름신 재판소] 비밀번호 재설정 안내",
      passwordResetEmail(user.nickname, resetUrl),
    );

    // SMTP 미설정(로컬 개발)이거나 발송 실패 시, 개발 환경에선 링크를 로그로 남겨 흐름을 이어갈 수 있게 한다
    if (!sent && this.config.get<string>("NODE_ENV") !== "production") {
      this.logger.warn(`[DEV] 비밀번호 재설정 링크 (${email}): ${resetUrl}`);
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!record) {
      throw new BadRequestException(
        "유효하지 않거나 만료된 재설정 링크입니다.",
      );
    }

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { password: hashed },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  private hashToken(raw: string): string {
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  private toSafeUser(user: {
    id: string;
    email: string | null;
    nickname: string;
    provider: string;
    createdAt: Date;
  }): SafeUser {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      provider: user.provider,
      createdAt: user.createdAt,
    };
  }
}
