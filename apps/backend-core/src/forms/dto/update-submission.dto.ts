import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSubmissionDto {
  @IsOptional()
  @IsIn(['NEW', 'IN_REVIEW', 'DONE'])
  status?: 'NEW' | 'IN_REVIEW' | 'DONE';

  /** یادداشت داخلی تیم — هرگز به پاسخ‌دهنده یا API عمومی نمی‌رسد. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNote?: string;
}
