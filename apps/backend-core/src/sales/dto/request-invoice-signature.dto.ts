import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SIGNATURE_POLICIES } from '../invoice-signing.js';

export class RequestInvoiceSignatureDto {
  /** امضاکننده (کاربر دارای دسترسی مهر و امضا)؛ خالی = پیش‌فرض (مالک). */
  @IsOptional()
  @IsUUID()
  signerUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class SetSignaturePolicyDto {
  @IsIn(SIGNATURE_POLICIES as unknown as string[])
  policy!: string;
}
