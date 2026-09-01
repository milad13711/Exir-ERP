import { IsString, IsUrl, MinLength } from 'class-validator';

export class CreateAttachmentDto {
  @IsString()
  @MinLength(1)
  entityType!: string;

  @IsString()
  @MinLength(1)
  entityId!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsUrl({ require_tld: false })
  fileUrl!: string;
}
