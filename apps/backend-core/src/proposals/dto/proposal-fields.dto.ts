import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export const MAX_PROPOSAL_AMOUNT = 2_000_000_000; // سقف INT4 پایگاه‌داده (تومان)

export class ProposalInvoiceLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description!: string;

  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_PROPOSAL_AMOUNT)
  unitPrice!: number;
}

/** فیلدهای مشترک ساخت/ویرایش (بدون عنوان و مشتری که در ساخت الزامی و در ویرایش اختیاری‌اند). */
export class ProposalFieldsDto {
  @IsOptional() @IsUUID() dealId?: string | null;
  @IsOptional() @IsString() @MaxLength(60000) content?: string;
  @IsOptional() @IsString() @MaxLength(200) durationText?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_PROPOSAL_AMOUNT) amount?: number;
  @IsOptional() @IsString() @MaxLength(200) paymentMethodText?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) paymentTerms?: string | null;
  @IsOptional() @IsString() @MaxLength(200) paymentDeadline?: string | null;
  @IsOptional() @IsISO8601() paymentDueAt?: string | null;
  @IsOptional() @IsString() @MaxLength(300) bankInfo?: string | null;
  @IsOptional() @IsISO8601() validUntil?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) internalNote?: string | null;
  @IsOptional() @IsUUID() assignedUserId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProposalInvoiceLineDto)
  invoiceLines?: ProposalInvoiceLineDto[] | null;
}
