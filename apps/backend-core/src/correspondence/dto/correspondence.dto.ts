import { Transform, Type } from 'class-transformer';
import { cleanValue } from '../text-clean.js';

const Clean = () => Transform(({ value }) => cleanValue(value));
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { ClientSignatureEvidenceDto } from '../../common/signature-evidence/index.js';
import { CONFIDENTIALITIES, DELIVERY_METHODS, NUMBER_RESET_POLICIES, PRIORITIES } from '../correspondence.constants.js';

export class RecipientDto {
  @Clean() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @Clean() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(200) org?: string;
  @IsOptional() @IsString() @MaxLength(60) contactId?: string;
  /** گیرنده‌ی داخلی (کاربر سامانه) — برای نامه‌ی داخلی دید می‌دهد */
  @IsOptional() @IsString() @MaxLength(60) userId?: string;
}

export class SignatureBlockDto {
  @Clean() @IsOptional() @IsString() @MaxLength(120) signerTitle?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(120) orgName?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(80) signerName?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(20) honorific?: string;
  @IsOptional() @IsBoolean() showDate?: boolean;
}

export class SignerOverrideDto {
  @Clean() @IsOptional() @IsString() @MaxLength(200) titleTemplate?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(200) nameTemplate?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(120) signerTitle?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(20) honorific?: string;
  @IsOptional() @IsBoolean() showDate?: boolean;
}

export class SignatureDefaultsDto {
  @Clean() @IsOptional() @IsString() @MaxLength(200) titleTemplate?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(200) nameTemplate?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(20) honorific?: string;
  @IsOptional() @IsBoolean() showDate?: boolean;
  /** userId → بازنویسی برای همان امضاکننده (اعتبارسنجی عمیق در sanitizeDefaults) */
  @IsOptional() @IsObject() perSigner?: Record<string, SignerOverrideDto>;
}

export class CreateLetterDto {
  @IsOptional() @IsObject() @ValidateNested() @Type(() => SignatureBlockDto) signatureBlock?: SignatureBlockDto | null;
  @IsIn(['OUTGOING', 'INTERNAL']) type!: 'OUTGOING' | 'INTERNAL';
  @Clean() @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(400_000) bodyHtml?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RecipientDto) recipients?: RecipientDto[];
  @Clean() @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(200, { each: true }) ccNames?: string[];
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: string;
  @IsOptional() @IsIn(CONFIDENTIALITIES as unknown as string[]) confidentiality?: string;
  @IsOptional() @IsISO8601() letterDate?: string;
  @IsOptional() @IsISO8601() responseDueAt?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(500) attachmentsText?: string;
  @IsOptional() @IsString() @MaxLength(60) letterheadId?: string;
  @IsOptional() @IsString() @MaxLength(60) templateId?: string;
  @IsOptional() @IsString() @MaxLength(60) replyToLetterId?: string;
  @IsOptional() @IsString() @MaxLength(60) relatedContactId?: string;
  @IsOptional() @IsString() @MaxLength(60) relatedProjectId?: string;
  @IsOptional() @IsString() @MaxLength(60) relatedContractId?: string;
  @IsOptional() @IsString() @MaxLength(60) relatedInvoiceId?: string;
  @Clean() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
}

export class UpdateLetterDto {
  @IsOptional() @IsObject() @ValidateNested() @Type(() => SignatureBlockDto) signatureBlock?: SignatureBlockDto | null;
  @Clean() @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(400_000) bodyHtml?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RecipientDto) recipients?: RecipientDto[];
  @Clean() @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(200, { each: true }) ccNames?: string[];
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: string;
  @IsOptional() @IsIn(CONFIDENTIALITIES as unknown as string[]) confidentiality?: string;
  @IsOptional() @IsISO8601() letterDate?: string;
  @IsOptional() @IsISO8601() responseDueAt?: string | null;
  @Clean() @IsOptional() @IsString() @MaxLength(500) attachmentsText?: string;
  @IsOptional() @IsString() @MaxLength(60) letterheadId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) templateId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) relatedContactId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) relatedProjectId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) relatedContractId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) relatedInvoiceId?: string | null;
  @Clean() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  // فیلدهای وارده
  @Clean() @IsOptional() @IsString() @MaxLength(100) externalNumber?: string;
  @IsOptional() @IsISO8601() externalDate?: string | null;
  @IsOptional() @IsISO8601() receivedAt?: string | null;
  @IsOptional() @IsIn(DELIVERY_METHODS as unknown as string[]) deliveryMethod?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(200) senderOrgName?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(200) senderName?: string;
  @IsOptional() @IsString() @MaxLength(60) senderContactId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100000) pageCount?: number;
  /** ذخیره‌ی خودکار: بدون نسخه و بدون رویداد */
  @IsOptional() @IsBoolean() autosave?: boolean;
  /** دلیل ویرایش (برای وارده‌ی ثبت‌شده الزامی) */
  @Clean() @IsOptional() @IsString() @MaxLength(500) reason?: string;
  /** updatedAt که کلاینت دیده؛ اگر عوض شده باشد ۴۰۹ */
  @IsOptional() @IsISO8601() baseUpdatedAt?: string;
}

export class ReferralInputDto {
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) toUserIds!: string[];
  @Clean() @IsOptional() @IsString() @MaxLength(2000) instruction?: string;
  @IsOptional() @IsISO8601() dueAt?: string;
  /** INFO = رونوشت/جهت اطلاع */
  @IsOptional() @IsIn(['ACTION', 'INFO']) kind?: 'ACTION' | 'INFO';
}

export class RegisterIncomingDto {
  @Clean() @IsString() @MinLength(1) @MaxLength(300) subject!: string;
  @Clean() @IsOptional() @IsString() @MaxLength(100) externalNumber?: string;
  @IsOptional() @IsISO8601() externalDate?: string;
  @IsOptional() @IsISO8601() receivedAt?: string;
  @IsOptional() @IsIn(DELIVERY_METHODS as unknown as string[]) deliveryMethod?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(200) senderOrgName?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(200) senderName?: string;
  @IsOptional() @IsString() @MaxLength(60) senderContactId?: string;
  @IsOptional() @IsString() @MaxLength(400_000) bodyHtml?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: string;
  @IsOptional() @IsIn(CONFIDENTIALITIES as unknown as string[]) confidentiality?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) pageCount?: number;
  @Clean() @IsOptional() @IsString() @MaxLength(500) attachmentsText?: string;
  @IsOptional() @IsISO8601() responseDueAt?: string;
  @Clean() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(60) relatedContactId?: string;
  @IsOptional() @IsString() @MaxLength(60) relatedProjectId?: string;
  @IsOptional() @IsString() @MaxLength(60) relatedContractId?: string;
  @IsOptional() @IsString() @MaxLength(60) relatedInvoiceId?: string;
  /** ثبت با وجود تکراری بودن (فقط مجاز) */
  @IsOptional() @IsBoolean() allowDuplicate?: boolean;
  @IsOptional() @ValidateNested() @Type(() => ReferralInputDto) referral?: ReferralInputDto;
}

export class SubmitDto {
  @IsString() signerUserId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) reviewerUserIds?: string[];
  @Clean() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class SignDto {
  /** تأیید صریح پس از دیدن اطلاعیه‌ی مدرک امضا */
  @IsBoolean() confirm!: boolean;
  /** استفاده از تصویر امضا/مهر ثبت‌شده‌ی شرکت (فقط مالک/نماینده‌ی مهر) */
  @IsOptional() @IsBoolean() useStamp?: boolean;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ClientSignatureEvidenceDto) evidence?: ClientSignatureEvidenceDto;
}

export class NoteDto {
  @Clean() @IsString() @MinLength(1) @MaxLength(2000) note!: string;
}
export class OptionalNoteDto {
  @Clean() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class ReasonDto {
  @Clean() @IsString() @MinLength(2) @MaxLength(1000) reason!: string;
}

export class ReviewDecisionDto {
  @IsIn(['APPROVE', 'CHANGES']) decision!: 'APPROVE' | 'CHANGES';
  @Clean() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class ParaphDto {
  @Clean() @IsString() @MinLength(1) @MaxLength(1000) text!: string;
}

export class ForwardReferralDto extends ReferralInputDto {
  @Clean() @IsOptional() @IsString() @MaxLength(2000) response?: string;
}

export class ReferralResponseDto {
  @Clean() @IsOptional() @IsString() @MaxLength(2000) response?: string;
}
export class ReferralReturnDto {
  @Clean() @IsString() @MinLength(1) @MaxLength(2000) response!: string;
}

export class ExternalFollowupDto {
  @Clean() @IsString() @MinLength(1) @MaxLength(3000) text!: string;
  /** NOTE | CALL | RESPONSE */
  @IsOptional() @IsIn(['NOTE', 'CALL', 'RESPONSE']) kind?: 'NOTE' | 'CALL' | 'RESPONSE';
  @IsOptional() @IsISO8601() at?: string;
}

export class MarkSentDto {
  @IsIn(DELIVERY_METHODS as unknown as string[]) method!: string;
  @Clean() @IsOptional() @IsString() @MaxLength(200) recipientName?: string;
  @IsOptional() @IsISO8601() sentAt?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(120) trackingCode?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class MarkDeliveredDto {
  @IsOptional() @IsISO8601() deliveredAt?: string;
  @Clean() @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @MaxLength(60) receiptAttachmentId?: string;
}

export class ArchiveDto {
  @IsOptional() @IsString() @MaxLength(60) folderId?: string;
  @IsOptional() @IsISO8601() retentionUntil?: string;
}
export class BulkArchiveDto extends ArchiveDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids!: string[];
}

export class ReplyDto {
  @IsOptional() @IsIn(['OUTGOING', 'INTERNAL']) type?: 'OUTGOING' | 'INTERNAL';
}

export class CategoryDto {
  @Clean() @IsString() @MinLength(1) @MaxLength(40) code!: string;
  @Clean() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}
export class UpdateCategoryDto {
  @Clean() @IsOptional() @IsString() @MinLength(1) @MaxLength(40) code?: string;
  @Clean() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}

export class NumberingSchemeDto {
  @Clean() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsIn(['INCOMING', 'OUTGOING', 'INTERNAL']) type!: 'INCOMING' | 'OUTGOING' | 'INTERNAL';
  @Clean() @IsString() @MinLength(1) @MaxLength(120) pattern!: string;
  @IsOptional() @IsIn(NUMBER_RESET_POLICIES as unknown as string[]) resetPolicy?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) startAt?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateNumberingSchemeDto {
  @Clean() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @Clean() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) pattern?: string;
  @IsOptional() @IsIn(NUMBER_RESET_POLICIES as unknown as string[]) resetPolicy?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) startAt?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class FolderDto {
  @Clean() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(36500) retentionDays?: number | null;
}

export class PreviewNumberDto {
  @IsOptional() @IsString() categoryId?: string;
}
