import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { IsHttpUrl } from '../../common/validators/is-http-url.js';
import { IsUploadDataUri } from '../../common/validators/upload-limits.js';
import { ClientSignatureEvidenceDto } from '../../common/signature-evidence/signature-evidence.dto.js';
import { AGENT_LEVELS, FUNNEL_STAGES, MEMBERSHIP_STATUSES } from '../agent-constants.js';

const LEVELS = AGENT_LEVELS as unknown as string[];

export class ApproveMembershipItemDto {
  @IsString() productId!: string;
  @IsOptional() @IsIn(LEVELS) level?: string;
}

export class ApproveApplicationDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ApproveMembershipItemDto) memberships!: ApproveMembershipItemDto[];
}

export class RejectApplicationDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CreateAgentProfileDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ApproveMembershipItemDto) memberships!: ApproveMembershipItemDto[];
}

export class UpdateAgentProfileDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsString() @MaxLength(600) bio?: string;
  @IsOptional() @IsString() @IsHttpUrl() websiteUrl?: string;
  /** عکس نماینده — data-URI از prepareUpload فرانت یا لینک http(s) */
  @IsOptional() @IsString() @IsUploadDataUri('smallImage', { allowHttp: true }) logoUrl?: string;
  @IsOptional() @IsBoolean() isVerified?: boolean;
}

export class UpdateMyProfileDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(600) bio?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsString() @IsUploadDataUri('smallImage') logoUrl?: string;
}

export class RequestProfileChangeDto {
  @IsIn(['SHEBA', 'PHONE']) kind!: 'SHEBA' | 'PHONE';
  @IsString() @MaxLength(40) value!: string;
}

export class ConfirmProfileChangeDto {
  @IsString() changeId!: string;
  @IsString() @Matches(/^\d{6}$/, { message: 'کد تأیید ۶ رقمی است' }) code!: string;
}

export class AddMembershipDto {
  @IsString() productId!: string;
  @IsOptional() @IsIn(LEVELS) level?: string;
}

export class UpdateMembershipDto {
  @IsOptional() @IsIn(LEVELS) level?: string;
  @IsOptional() @IsIn(MEMBERSHIP_STATUSES as unknown as string[]) status?: string;
  /** کد معرف — دستی؛ رشته‌ی خالی = حذف کد */
  @IsOptional() @IsString() @MaxLength(40) referralCode?: string;
  @IsOptional() @IsString() @MaxLength(400) note?: string;
  @IsOptional() @IsString() @MaxLength(300) endReason?: string;
}

export class AcceptAgreementDto {
  @IsString() agreementId!: string;
  @IsString() @MinLength(2) @MaxLength(120) signerName!: string;
  @IsString() @IsUploadDataUri('smallImage') signatureDataUrl!: string;
  @IsOptional() @ValidateNested() @Type(() => ClientSignatureEvidenceDto) evidence?: ClientSignatureEvidenceDto;
}

export class ChangeStageDto {
  @IsIn(FUNNEL_STAGES as unknown as string[]) stage!: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
