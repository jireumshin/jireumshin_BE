import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { KakaoService } from './kakao.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto, ResetRequestDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  ACCESS_TOKEN_COOKIE,
  OAUTH_STATE_COOKIE,
  accessTokenCookieOptions,
  clearCookieOptions,
  clearOauthStateCookieOptions,
  oauthStateCookieOptions,
} from './cookie.util';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly kakaoService: KakaoService,
    private readonly config: ConfigService,
  ) {}

  @Post('signup')
  @ApiOperation({ summary: '회원가입 (가입 후 자동 로그인)' })
  async signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.signup(dto);
    const token = this.authService.signToken(user);
    res.cookie(ACCESS_TOKEN_COOKIE, token, accessTokenCookieOptions());
    return user;
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '로그인 (JWT를 httpOnly 쿠키로 발급)' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    const token = this.authService.signToken(user);
    res.cookie(ACCESS_TOKEN_COOKIE, token, accessTokenCookieOptions());
    return user;
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: '로그아웃 (쿠키 삭제)' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ACCESS_TOKEN_COOKIE, clearCookieOptions());
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '현재 로그인한 사용자 정보 (세션 복원용)' })
  me(@Req() req: Request) {
    const { userId } = req.user as { userId: string };
    return this.authService.me(userId);
  }

  @Post('password/reset-request')
  @HttpCode(200)
  @ApiOperation({
    summary: '비밀번호 재설정 요청 (재설정 링크 메일 발송)',
    description:
      '계정 존재 여부 노출을 막기 위해 이메일 등록 여부·발송 결과와 무관하게 200을 반환한다.',
  })
  async requestReset(@Body() dto: ResetRequestDto) {
    await this.authService.requestPasswordReset(dto.email);
    return { message: '재설정 안내를 이메일로 보냈어요.' };
  }

  @Post('password/reset')
  @HttpCode(200)
  @ApiOperation({ summary: '비밀번호 재설정 (토큰 검증 후 변경)' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { success: true };
  }

  @Get('kakao')
  @ApiOperation({ summary: '카카오 인증 페이지로 리다이렉트' })
  kakaoStart(@Res() res: Response) {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions());
    res.redirect(this.kakaoService.buildAuthorizeUrl(state));
  }

  @Get('kakao/callback')
  @ApiOperation({
    summary: '카카오 콜백 — 토큰 발급 후 프론트로 리다이렉트',
    description:
      '실패해도 JSON을 반환하지 않고 프론트 로그인 화면으로 되돌려보낸다(브라우저 이동 흐름이므로).',
  })
  async kakaoCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    const appUrl = (
      this.config.get<string>('APP_URL') || 'http://localhost:3000'
    ).replace(/\/$/, '');
    const expected = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
    res.clearCookie(OAUTH_STATE_COOKIE, clearOauthStateCookieOptions());

    // state 불일치 = CSRF 의심. code 없음 = 사용자가 동의를 취소한 경우
    if (!code || !state || !expected || state !== expected) {
      return res.redirect(`${appUrl}/login/?error=kakao`);
    }

    try {
      const profile = await this.kakaoService.fetchProfile(code);
      const user = await this.authService.loginWithKakao(profile);
      const token = this.authService.signToken(user);
      res.cookie(ACCESS_TOKEN_COOKIE, token, accessTokenCookieOptions());
      return res.redirect(`${appUrl}/`);
    } catch {
      return res.redirect(`${appUrl}/login/?error=kakao`);
    }
  }
}
