import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class ClientScreenDto {
  @IsNumber() @Min(0) @Max(100000) w!: number;
  @IsNumber() @Min(0) @Max(100000) h!: number;
}

export class ClientGeoDto {
  @IsIn(['granted', 'denied', 'unavailable']) status!: 'granted' | 'denied' | 'unavailable';
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10_000_000) accuracy?: number;
}

/** شواهد سمت کلاینت؛ همیشه اختیاری و غیرقابل‌اعتماد (IP/زمان سرور/هش‌ها را فقط سرور تعیین می‌کند). */
export class ClientSignatureEvidenceDto {
  @IsOptional() @IsString() @MaxLength(40) clientTime?: string;
  @IsOptional() @IsString() @MaxLength(80) timezone?: string;
  @IsOptional() @IsString() @MaxLength(40) language?: string;
  @IsOptional() @IsString() @MaxLength(80) platform?: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ClientScreenDto) screen?: ClientScreenDto;
  @IsOptional() @IsBoolean() touch?: boolean;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ClientGeoDto) geo?: ClientGeoDto;
}

export type ClientSignatureEvidence = ClientSignatureEvidenceDto;
