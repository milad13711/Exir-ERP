import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ClientSignatureEvidenceDto } from '../../common/signature-evidence/signature-evidence.dto.js';

/** امضای ترسیمی صفحه‌ی عمومی: فقط تصویر PNG/JPEG با سقف حجم (≈ ۴۰۰ کیلوبایت). */
export const PUBLIC_SIGNATURE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;

export class PublicDeliveryConfirmDto {
  @IsIn(['CODE', 'SIGNATURE'])
  method!: 'CODE' | 'SIGNATURE';

  /** کد ۶ رقمی پیامک‌شده (فقط روش CODE). */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'کد تأیید باید ۶ رقم باشد' })
  code?: string;

  /** امضای ترسیمی (فقط روش SIGNATURE). */
  @IsOptional()
  @IsString()
  @MaxLength(550_000)
  @Matches(PUBLIC_SIGNATURE_RE, { message: 'تصویر امضا نامعتبر است' })
  signatureDataUrl?: string;

  /** نام تحویل‌گیرنده — همان‌طور که خودش تایپ می‌کند. */
  @IsString()
  @MinLength(2, { message: 'نام تحویل‌گیرنده را وارد کنید' })
  @MaxLength(100)
  confirmerName!: string;

  /** پذیرش اعلان ثبت اطلاعات دستگاه/زمان/موقعیت به‌عنوان مدرک — برای روش امضا الزامی است. */
  @IsOptional()
  @IsBoolean()
  consent?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClientSignatureEvidenceDto)
  evidence?: ClientSignatureEvidenceDto;
}

