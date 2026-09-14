import { IsBoolean } from 'class-validator';

export class AcceptOfferDto {
  @IsBoolean()
  accepted!: boolean;
}
