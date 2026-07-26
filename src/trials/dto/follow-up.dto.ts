import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class FollowUpDto {
  @ApiProperty({ example: false, description: '결국 샀는지' })
  @IsBoolean()
  purchased: boolean;

  @ApiProperty({ example: true, description: '후회하는지' })
  @IsBoolean()
  regret: boolean;
}
