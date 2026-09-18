import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsIn(['INVITED', 'ACTIVE', 'DISABLED'])
  status?: 'INVITED' | 'ACTIVE' | 'DISABLED';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleIds?: string[];
}
