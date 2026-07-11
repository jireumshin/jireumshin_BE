import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: '서버 상태 확인' })
  @ApiResponse({
    status: 200,
    description: '서버 정상 동작',
    schema: {
      example: {
        status: 'ok',
        service: 'jireumshin-be',
        timestamp: '2026-07-11T05:41:27.159Z',
      },
    },
  })
  check() {
    return {
      status: 'ok',
      service: 'jireumshin-be',
      timestamp: new Date().toISOString(),
    };
  }
}
