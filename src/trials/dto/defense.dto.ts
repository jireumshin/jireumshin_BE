import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DefenseDto {
  @ApiProperty({
    example: '이거 매일 출퇴근 2시간씩 쓸 거라 하루 단가로 치면 얼마 안 돼요',
    description: '피고인의 변론 (배심원 설득)',
  })
  @IsString()
  @MinLength(2, { message: '변론을 조금 더 적어주세요.' })
  @MaxLength(500, { message: '변론은 500자 이내로 적어주세요.' })
  message: string;

  @ApiPropertyOptional({ enum: ['A', 'B'], description: 'VERSUS 변론에서 편드는 물건' })
  @IsOptional()
  @IsIn(['A', 'B'])
  target?: 'A' | 'B';
}
