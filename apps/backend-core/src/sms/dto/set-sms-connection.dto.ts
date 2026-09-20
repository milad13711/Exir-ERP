import { IsIn, IsOptional, IsString } from 'class-validator';

export class SetSmsConnectionDto {
  @IsIn(['NONE', 'SYSTEM', 'OWN'])
  mode!: 'NONE' | 'SYSTEM' | 'OWN';

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  senderNumber?: string;
}
