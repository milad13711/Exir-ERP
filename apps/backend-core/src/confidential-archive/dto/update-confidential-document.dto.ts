import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { ConfidentialDocumentCategoryValue } from './create-confidential-document.dto.js';

const CATEGORIES = ['PASSWORD', 'TECHNICAL_KNOWLEDGE', 'FORMULATION', 'CONFIDENTIAL_CONTRACT', 'SYSTEM_LOG', 'OTHER'] as const;

export class UpdateConfidentialDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: ConfidentialDocumentCategoryValue;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  fileData?: string;
}
