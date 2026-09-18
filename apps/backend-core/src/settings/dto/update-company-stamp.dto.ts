import { IsOptional, IsString, ValidateIf } from 'class-validator';

export class UpdateCompanyStampDto {
  @IsOptional()
  @ValidateIf((o) => o.signatureImage !== null)
  @IsString()
  signatureImage?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.stampImage !== null)
  @IsString()
  stampImage?: string | null;
}
