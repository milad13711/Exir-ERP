import { IsString } from 'class-validator';

export class DeleteTenantDto {
  /** Must exactly match the tenant's slug — a deliberate typed confirmation for an irreversible action. */
  @IsString()
  confirmSlug!: string;
}
