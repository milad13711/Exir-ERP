import { IsString } from 'class-validator';

export class SwitchTenantDto {
  @IsString()
  tenantSlug!: string;
}
