import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const CATEGORIES = ['PASSWORD', 'TECHNICAL_KNOWLEDGE', 'FORMULATION', 'CONFIDENTIAL_CONTRACT', 'SYSTEM_LOG', 'OTHER'] as const;
export type ConfidentialDocumentCategoryValue = (typeof CATEGORIES)[number];

export class CreateConfidentialDocumentDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsIn(CATEGORIES)
  category!: ConfidentialDocumentCategoryValue;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  /** data URL به‌صورت base64 — همان قرارداد CompanyStampService. */
  @IsOptional()
  @IsString()
  fileData?: string;
}
