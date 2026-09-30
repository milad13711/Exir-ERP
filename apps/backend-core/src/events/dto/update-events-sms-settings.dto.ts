import { IsBoolean, IsString } from 'class-validator';

export class UpdateEventsSmsSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  ticketIssuedTemplate!: string;
}
