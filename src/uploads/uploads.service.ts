import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>("AWS_REGION") ?? "ap-northeast-2";
    this.bucket = this.config.get<string>("S3_UPLOAD_BUCKET") ?? "";
    this.publicBase =
      this.config.get<string>("S3_PUBLIC_BASE_URL") ??
      `https://${this.bucket}.s3.${region}.amazonaws.com`;
    this.client = new S3Client({ region });
  }

  get enabled(): boolean {
    return !!this.bucket;
  }

  async putImage(buffer: Buffer, mimetype: string): Promise<string> {
    if (!this.enabled) {
      throw new InternalServerErrorException(
        "이미지 저장소(S3)가 설정되지 않았습니다.",
      );
    }
    const ext = EXT[mimetype] ?? "jpg";
    const key = `products/${randomUUID()}.${ext}`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimetype,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    } catch (error) {
      this.logger.error(
        `S3 업로드 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new InternalServerErrorException("이미지 업로드에 실패했습니다.");
    }
    return `${this.publicBase}/${key}`;
  }
}
