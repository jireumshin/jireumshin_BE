import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class MessageVisibilityDto {
  @ApiProperty({ example: true, description: '공개본에서 숨길지' })
  @IsBoolean()
  hidden: boolean;
}
