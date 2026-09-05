import { IsOptional, IsString } from 'class-validator';

export class SaveCompanySignatureDto {
  @IsOptional()
  @IsString()
  signatureImage?: string;

  @IsOptional()
  @IsString()
  stampImage?: string;
}
