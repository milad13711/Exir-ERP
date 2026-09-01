import { IsInt, Max, Min } from 'class-validator';

export class RenewTenantDto {
  @IsInt()
  @Min(1)
  @Max(24)
  months!: number;
}
