import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ example: '저도 같은 거 샀는데 후회 없어요', description: '댓글 내용' })
  @IsString()
  @MinLength(1, { message: '댓글을 입력해주세요.' })
  @MaxLength(300, { message: '댓글은 300자 이내로 적어주세요.' })
  content: string;
}
