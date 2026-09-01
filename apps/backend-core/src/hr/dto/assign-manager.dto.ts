import { IsOptional, IsString } from 'class-validator';

export class AssignManagerDto {
  @IsOptional()
  @IsString()
  managerId?: string | null;
}
