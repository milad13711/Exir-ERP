import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ClientSignatureEvidenceDto } from '../../common/signature-evidence/signature-evidence.dto.js';

export class DecideApprovalDto {
  @IsBoolean()
  approved!: boolean;

  /** «تأیید و اجازه‌ی درج مهر و امضا» — فقط برای اسناد رسمی. */
  @IsOptional()
  @IsBoolean()
  withStamp?: boolean;

  @IsOptional()
  @IsString()
  note?: string;

  /** شواهد حقوقی تأیید همراه مهر/امضا از مرورگر؛ اختیاری. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientSignatureEvidenceDto)
  evidence?: ClientSignatureEvidenceDto;
}
