import { IsOptional, IsString } from 'class-validator';

export class SetModuleApproverDto {
  @IsOptional()
  @IsString()
  userId?: string | null;
}
