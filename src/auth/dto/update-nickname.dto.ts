import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class UpdateNicknameDto {
  @ApiProperty({ example: '지름신판사', description: '새 닉네임 (2~16자)' })
  @IsString()
  @Matches(/^[a-zA-Z0-9가-힣_]{2,16}$/, {
    message: '닉네임은 한글·영문·숫자·_ 2~16자여야 합니다.',
  })
  nickname: string;
}
