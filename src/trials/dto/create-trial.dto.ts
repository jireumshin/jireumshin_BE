import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateTrialDto {
  @ApiProperty({ example: '노이즈캔슬링 무선 헤드폰', description: '기소 대상 물건' })
  @IsString()
  @MaxLength(40)
  itemName: string;

  @ApiProperty({ example: 349000, description: '가격(원)' })
  @IsInt()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: '신형 색깔이 예뻐서요…', description: '사려는 이유' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({ description: '상품 이미지 URL' })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}
