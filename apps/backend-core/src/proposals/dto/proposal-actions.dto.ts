import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDataURI, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ProposalInvoiceLineDto } from './proposal-fields.dto.js';

export const PROPOSAL_STATUSES = ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'REVISION_REQUESTED', 'EXPIRED'] as const;
export type ProposalStatusValue = (typeof PROPOSAL_STATUSES)[number];

export class SetProposalStatusDto {
  @IsIn(PROPOSAL_STATUSES)
  status!: ProposalStatusValue;

  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class UpdateStatusNoteDto {
  @IsString() @MaxLength(2000) statusNote!: string;
}

export class AssignProposalDto {
  @IsOptional() @IsUUID() userId?: string | null;
  /** ساخت وظیفه‌ی پیگیری برای همکار (ماژول وظایف) */
  @IsOptional() @IsBoolean() createTask?: boolean;
}

export class StaffCommentDto {
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;
}

export class IssueProposalInvoiceDto {
  @IsOptional() @IsISO8601() dueAt?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProposalInvoiceLineDto)
  lines?: ProposalInvoiceLineDto[];
}

export class CreateProposalTemplateDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  /** اگر پروپوزالی داده شود، قالب از محتوای آن ساخته می‌شود */
  @IsOptional() @IsUUID() proposalId?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(60000) content?: string;
  @IsOptional() @IsString() @MaxLength(200) durationText?: string;
  @IsOptional() @IsString() @MaxLength(200) paymentMethodText?: string;
  @IsOptional() @IsString() @MaxLength(5000) paymentTerms?: string;
  @IsOptional() @IsString() @MaxLength(200) paymentDeadline?: string;
  @IsOptional() @IsString() @MaxLength(300) bankInfo?: string;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) amount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) validDays?: number;
}

export class UpdateProposalTemplateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(60000) content?: string;
  @IsOptional() @IsString() @MaxLength(200) durationText?: string | null;
  @IsOptional() @IsString() @MaxLength(200) paymentMethodText?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) paymentTerms?: string | null;
  @IsOptional() @IsString() @MaxLength(200) paymentDeadline?: string | null;
  @IsOptional() @IsString() @MaxLength(300) bankInfo?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) amount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) validDays?: number | null;
}

// ── عمومی (مشتری) ──
const MAX_SIGNATURE_CHARS = 400_000; // ~۳۰۰ کیلوبایت باینری

export class PublicAcceptProposalDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MaxLength(MAX_SIGNATURE_CHARS) @IsDataURI() signatureDataUrl!: string;
  @IsBoolean() confirmed!: boolean;
}

export class PublicRejectProposalDto {
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
}

export class PublicCommentProposalDto {
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  /** true = «نیاز به اصلاحات» (وضعیت پروپوزال تغییر می‌کند)، false = فقط نظر */
  @IsOptional() @IsBoolean() requestRevision?: boolean;
}
