import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ClientSignatureEvidenceDto } from '../../common/signature-evidence/index.js';
import { IsUploadDataUri } from '../../common/validators/upload-limits.js';
import { SHIPMENT_STATUSES } from '../dispatch-state.js';

export class ShippingProfileDto {
  @IsOptional() @IsString() @MaxLength(40) uniqueId?: string;
  @IsOptional() @IsString() @MaxLength(40) nationalId?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(600) postalAddress?: string;
}

export class DeclareShipmentDto {
  @IsOptional() @IsIn(['MANUAL', 'SALES_INVOICE', 'PRODUCTION_ORDER', 'STOCK_MOVEMENT']) sourceType?: 'MANUAL' | 'SALES_INVOICE' | 'PRODUCTION_ORDER' | 'STOCK_MOVEMENT';
  @IsOptional() @IsString() sourceId?: string;
  @IsOptional() @IsString() contactId?: string;
  @IsString() @MinLength(1) @MaxLength(200) cargoType!: string;
  @IsInt() @Min(1) @Max(2_000_000_000) quantity!: number;
  @IsOptional() @IsString() @MaxLength(40) unit?: string;
  @IsString() @MinLength(2) @MaxLength(600) deliveryAddress!: string;
  @IsOptional() @IsString() @MaxLength(100) region?: string;
  @IsISO8601() pickupAt!: string;
  @IsOptional() @IsBoolean() needsWeighing?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) weighLineIds?: string[];
  @IsOptional() @IsNumber() @Min(0.001) @Max(100000) kgPerUnit?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) expectedWeightKg?: number;
  @IsOptional() @IsString() driverId?: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ShippingProfileDto) profile?: ShippingProfileDto;
  @IsOptional() @IsBoolean() saveToProfile?: boolean;
}

export class DriverDto {
  @IsString() driverId!: string;
}

export class CleanlinessDto {
  @IsIn(['PASS', 'FAIL']) result!: 'PASS' | 'FAIL';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class TareDto {
  @IsNumber() @Min(0.001) @Max(1_000_000) kg!: number;
}

export class GrossDto {
  @IsNumber() @Min(0.001) @Max(1_000_000) kg!: number;
}

export class NetEditDto {
  @IsNumber() @Min(0.001) @Max(1_000_000) netKg!: number;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class FinalCheckDto {
  @IsIn(['PASS', 'FAIL']) result!: 'PASS' | 'FAIL';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsBoolean() loadingCorrect?: boolean;
  @IsOptional() @IsBoolean() tarpInstalled?: boolean;
}

export class NoteDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class OptionalReasonDto {
  @IsOptional() @IsString() @MaxLength(500) overrideReason?: string;
}

export class ManualStatusDto {
  @IsIn(SHIPMENT_STATUSES as unknown as string[]) status!: (typeof SHIPMENT_STATUSES)[number];
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class AddDocumentDto {
  @IsString() @MaxLength(60) docTypeCode!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsUploadDataUri('file') fileUrl!: string;
  @IsOptional() @IsIn(['TARE', 'GROSS']) step?: 'TARE' | 'GROSS';
}

export class PaperReceiptDto {
  @IsString() @MaxLength(200) title!: string;
  @IsUploadDataUri('file') fileUrl!: string;
}

export class DecideAdjustmentDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class StepAccessDto {
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) roleIds!: string[];
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) userIds!: string[];
}

export class StepsDto {
  @ValidateNested() @Type(() => StepAccessDto) arrival!: StepAccessDto;
  @ValidateNested() @Type(() => StepAccessDto) cleanliness!: StepAccessDto;
  @ValidateNested() @Type(() => StepAccessDto) weighing!: StepAccessDto;
  @ValidateNested() @Type(() => StepAccessDto) loading!: StepAccessDto;
  @ValidateNested() @Type(() => StepAccessDto) finalCheck!: StepAccessDto;
  @ValidateNested() @Type(() => StepAccessDto) readyToDepart!: StepAccessDto;
  @ValidateNested() @Type(() => StepAccessDto) weightConfirm!: StepAccessDto;
}

export class ProductionTriggerSettingDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(0) @Max(20) stagesBeforeEnd!: number;
}

export class ReceiptSettingDto {
  @IsIn(['DEPARTURE', 'DELIVERY', 'NONE']) requiredBefore!: 'DEPARTURE' | 'DELIVERY' | 'NONE';
  @IsBoolean() smsEnabled!: boolean;
  @IsString() @MaxLength(500) smsTemplate!: string;
  @IsBoolean() archiveEnabled!: boolean;
}

export class UpdateDispatchSettingsDto {
  @ValidateNested() @Type(() => ProductionTriggerSettingDto) productionTrigger!: ProductionTriggerSettingDto;
  @ValidateNested() @Type(() => StepsDto) steps!: StepsDto;
  @ValidateNested() @Type(() => ReceiptSettingDto) receipt!: ReceiptSettingDto;
}

export class DocTypeDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
}

export class UpdateDocTypeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class DocRuleDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) minNetKg?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) cargoTypes?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) regions?: string[];
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) docTypeCodes!: string[];
  @IsOptional() @IsString() handlerRoleId?: string | null;
  @IsOptional() @IsString() handlerUserId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

export class ProductionTriggerDto {
  /** null = حذف جایگزین و بازگشت به پیش‌فرض تننت */
  @IsOptional() @IsInt() @Min(0) @Max(20) stagesBeforeEnd?: number | null;
}

export class SignReceiptDto {
  @IsString() @MaxLength(1_000_000) signatureData!: string;
  @IsBoolean() confirmed!: boolean;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ClientSignatureEvidenceDto) evidence?: ClientSignatureEvidenceDto;
}
