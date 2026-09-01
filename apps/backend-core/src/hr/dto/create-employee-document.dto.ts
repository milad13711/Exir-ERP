import { IsIn, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

const DOC_TYPES = ['CONTRACT', 'NATIONAL_ID', 'DEGREE_CERTIFICATE', 'OTHER'] as const;

export class CreateEmployeeDocumentDto {
  @IsIn(DOC_TYPES)
  type!: (typeof DOC_TYPES)[number];

  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  fileUrl!: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
