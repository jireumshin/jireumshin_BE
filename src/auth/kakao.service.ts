import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const AUTHORIZE_URL = 'https://kauth.kakao.com/oauth/authorize';
const TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const PROFILE_URL = 'https://kapi.kakao.com/v2/user/me';

export type KakaoProfile = {
  providerId: string;
  nickname: string | null;
  email: string | null;
  emailVerified: boolean;
};

@Injectable()
export class KakaoService {
  private readonly logger = new Logger(KakaoService.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.config.get<string>('KAKAO_CLIENT_ID'));
  }

  private get redirectUri(): string {
    return (
      this.config.get<string>('KAKAO_REDIRECT_URI') ||
      'http://localhost:4000/auth/kakao/callback'
    );
  }

  /** 카카오 인증 페이지 URL (state는 CSRF 방어용) */
  buildAuthorizeUrl(state: string): string {
    const clientId = this.config.get<string>('KAKAO_CLIENT_ID');
    if (!clientId) {
      throw new ServiceUnavailableException(
        '카카오 로그인이 설정되지 않았습니다.',
      );
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /** 인가 코드 → 액세스 토큰 */
  private async exchangeCodeForToken(code: string): Promise<string> {
    const clientId = this.config.get<string>('KAKAO_CLIENT_ID');
    const clientSecret = this.config.get<string>('KAKAO_CLIENT_SECRET');
    if (!clientId) {
      throw new ServiceUnavailableException(
        '카카오 로그인이 설정되지 않았습니다.',
      );
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: this.redirectUri,
      code,
    });
    if (clientSecret) body.append('client_secret', clientSecret);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const detail = await res.text();
      this.logger.error(`카카오 토큰 교환 실패 (${res.status}): ${detail}`);
      throw new BadRequestException('카카오 인증에 실패했습니다.');
    }

    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new BadRequestException('카카오 인증에 실패했습니다.');
    }
    return json.access_token;
  }

  /** 액세스 토큰 → 프로필. 이메일은 선택 동의라 없을 수 있다. */
  async fetchProfile(code: string): Promise<KakaoProfile> {
    const accessToken = await this.exchangeCodeForToken(code);

    const res = await fetch(PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const detail = await res.text();
      this.logger.error(`카카오 프로필 조회 실패 (${res.status}): ${detail}`);
      throw new BadRequestException('카카오 프로필을 가져오지 못했습니다.');
    }

    const json = (await res.json()) as {
      id?: number | string;
      kakao_account?: {
        email?: string;
        is_email_valid?: boolean;
        is_email_verified?: boolean;
        profile?: { nickname?: string };
      };
    };

    if (json.id === undefined || json.id === null) {
      throw new BadRequestException('카카오 프로필을 가져오지 못했습니다.');
    }

    const account = json.kakao_account ?? {};
    return {
      providerId: String(json.id),
      nickname: account.profile?.nickname ?? null,
      email: account.email ?? null,
      // 카카오가 유효·인증 둘 다 참으로 준 경우에만 신뢰한다 (계정 연동 판단에 쓰임)
      emailVerified:
        account.is_email_valid === true && account.is_email_verified === true,
    };
  }
}
