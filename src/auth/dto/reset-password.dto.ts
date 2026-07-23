import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetRequestDto {
  @ApiProperty({ example: 'user@example.com', description: '가입한 이메일' })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다.' })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: '이메일로 받은 재설정 토큰' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'newpassword1234', description: '새 비밀번호 (8자 이상)' })
  @IsString()
  @MinLength(8, { message: '비밀번호는 8자 이상이어야 합니다.' })
  @MaxLength(72, { message: '비밀번호는 72자 이하여야 합니다.' })
  newPassword: string;
}
