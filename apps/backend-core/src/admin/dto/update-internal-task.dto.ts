import { IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdateInternalTaskDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsString() assignedToId?: string;
}
