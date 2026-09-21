import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateInternalLeadDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsInt() @Min(0) value?: number;
  @IsOptional() @IsString() notes?: string;
}
