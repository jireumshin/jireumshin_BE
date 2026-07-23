import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @ApiProperty({ example: 'user@example.com', description: '이메일 (로그인 ID)' })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다.' })
  email: string;

  @ApiProperty({ example: '지름신판사', description: '닉네임 (2~16자)' })
  @IsString()
  @Matches(/^[a-zA-Z0-9가-힣_]{2,16}$/, {
    message: '닉네임은 한글·영문·숫자·_ 2~16자여야 합니다.',
  })
  nickname: string;

  @ApiProperty({ example: 'password1234', description: '비밀번호 (8자 이상)' })
  @IsString()
  @MinLength(8, { message: '비밀번호는 8자 이상이어야 합니다.' })
  @MaxLength(72, { message: '비밀번호는 72자 이하여야 합니다.' })
  password: string;
}
