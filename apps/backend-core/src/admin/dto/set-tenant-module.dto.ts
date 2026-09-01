import { IsIn } from 'class-validator';

export class SetTenantModuleDto {
  @IsIn(['INSTALLED', 'DISABLED'])
  status!: 'INSTALLED' | 'DISABLED';
}
