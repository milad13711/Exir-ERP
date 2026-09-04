import { IsOptional, IsString } from 'class-validator';

export class TerminateContractDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
