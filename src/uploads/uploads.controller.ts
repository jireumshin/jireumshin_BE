import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { UploadsService } from './uploads.service';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB (클라에서 압축 후 전송)
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('image')
  @UseGuards(OptionalJwtAuthGuard) // 익명 기소도 사진을 올릴 수 있어야 함
  @ApiOperation({ summary: '상품 이미지 업로드' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('이미지 파일이 없습니다.');
    }
    if (!ALLOWED.includes(file.mimetype)) {
      throw new BadRequestException('지원하지 않는 이미지 형식입니다.');
    }
    const imageUrl = await this.uploads.putImage(file.buffer, file.mimetype);
    return { imageUrl };
  }
}
