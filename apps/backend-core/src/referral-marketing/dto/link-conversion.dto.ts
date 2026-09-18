import { IsString } from 'class-validator';

export class LinkConversionDto {
  @IsString()
  contactId!: string;
}
