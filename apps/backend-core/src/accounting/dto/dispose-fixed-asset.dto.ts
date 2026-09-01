import { IsInt, IsISO8601, IsOptional, Min } from 'class-validator';

export class DisposeFixedAssetDto {
  @IsOptional()
  @IsISO8601()
  disposedAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  disposalAmount?: number;
}
