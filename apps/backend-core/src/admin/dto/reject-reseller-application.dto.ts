import { IsOptional, IsString } from 'class-validator';

export class RejectResellerApplicationDto {
  @IsOptional()
  @IsString()
  rejectionNote?: string;
}
