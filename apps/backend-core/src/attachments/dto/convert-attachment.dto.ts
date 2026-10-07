import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RenameAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
}

export class ConvertAttachmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(['PASSWORD', 'TECHNICAL_KNOWLEDGE', 'FORMULATION', 'CONFIDENTIAL_CONTRACT', 'SYSTEM_LOG', 'OTHER'])
  category?: 'PASSWORD' | 'TECHNICAL_KNOWLEDGE' | 'FORMULATION' | 'CONFIDENTIAL_CONTRACT' | 'SYSTEM_LOG' | 'OTHER';
}
