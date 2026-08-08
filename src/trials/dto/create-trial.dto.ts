import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateTrialDto {
  @ApiProperty({ example: '노이즈캔슬링 무선 헤드폰', description: '기소 대상 물건(A)' })
  @IsString()
  @MaxLength(40)
  itemName: string;

  @ApiProperty({ example: 349000, description: '가격(원)' })
  @IsInt()
  @Min(0)
  price: number;

  @ApiProperty({ example: '신형 색깔이 예뻐서요…', description: '사려는 이유(필수 — 이유를 듣고 판결)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ description: '상품 이미지 URL' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    enum: ['SINGLE', 'VERSUS'],
    description: 'SINGLE=살까말까, VERSUS=A vs B 비교. 기본 SINGLE',
  })
  @IsOptional()
  @IsIn(['SINGLE', 'VERSUS'])
  mode?: 'SINGLE' | 'VERSUS';

  // ── VERSUS 모드일 때 비교 대상 B (mode=VERSUS면 itemNameB·priceB 필수) ──
  @ApiPropertyOptional({ description: '비교 대상 B 물건 (VERSUS 필수)' })
  @ValidateIf((o) => o.mode === 'VERSUS')
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  itemNameB?: string;

  @ApiPropertyOptional({ description: 'B 가격(원) (VERSUS 필수)' })
  @ValidateIf((o) => o.mode === 'VERSUS')
  @IsInt()
  @Min(0)
  priceB?: number;

  @ApiPropertyOptional({ description: 'B 사려는 이유 (VERSUS 필수)' })
  @ValidateIf((o) => o.mode === 'VERSUS')
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reasonB?: string;

  @ApiPropertyOptional({ description: 'B 상품 이미지 URL' })
  @IsOptional()
  @IsString()
  imageUrlB?: string;
}
