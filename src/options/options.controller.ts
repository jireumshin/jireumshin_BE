import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AVATARS, avatarUrl } from './avatars';

@ApiTags('options')
@Controller('options')
export class OptionsController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @ApiOperation({ summary: '선택지 목록 (프로필 캐릭터 등)' })
  list() {
    const base = this.config.get<string>('S3_PUBLIC_BASE_URL') ?? '';
    return {
      avatars: AVATARS.map((a) => ({ ...a, url: avatarUrl(base, a.key) })),
    };
  }
}
