import { IsString } from 'class-validator';

export class SelectTenantDto {
  @IsString()
  verificationToken!: string;

  @IsString()
  tenantSlug!: string;
}
