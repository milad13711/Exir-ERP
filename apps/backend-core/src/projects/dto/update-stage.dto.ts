import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateStageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  /** رشته‌ی خالی = برداشتن مسئول مرحله. */
  @IsOptional()
  @IsString()
  responsibleUserId?: string;
}
