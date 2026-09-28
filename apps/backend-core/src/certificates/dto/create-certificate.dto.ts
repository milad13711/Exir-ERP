import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CertificateItemDto {
  @IsString()
  @MinLength(1)
  titleFa!: string;

  @IsOptional()
  @IsString()
  titleEn?: string;
}

export class CreateCertificateDto {
  @IsIn(['EMPLOYEE', 'CONTACT'])
  recipientType!: 'EMPLOYEE' | 'CONTACT';

  @ValidateIf((o) => o.recipientType === 'EMPLOYEE')
  @IsString()
  employeeId?: string;

  @ValidateIf((o) => o.recipientType === 'CONTACT')
  @IsString()
  crmContactId?: string;

  @IsString()
  @MinLength(2)
  recipientNameEn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  nationalId?: string;

  @IsString()
  @MinLength(2)
  titleFa!: string;

  @IsOptional()
  @IsString()
  titleEn?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CertificateItemDto)
  items?: CertificateItemDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  durationHours?: number;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;
}
