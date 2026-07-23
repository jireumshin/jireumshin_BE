import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto, ResetRequestDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  ACCESS_TOKEN_COOKIE,
  accessTokenCookieOptions,
  clearCookieOptions,
} from './cookie.util';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
