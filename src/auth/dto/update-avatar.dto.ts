import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AVATAR_KEYS } from '../../options/avatars';

export class UpdateAvatarDto {
  @ApiProperty({ example: 'judge', enum: AVATAR_KEYS })
  @IsIn(AVATAR_KEYS, { message: '선택할 수 없는 캐릭터입니다.' })
  avatar: string;
}
