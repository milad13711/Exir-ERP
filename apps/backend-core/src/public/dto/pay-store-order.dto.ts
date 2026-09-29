import { IsString } from 'class-validator';

export class PayStoreOrderDto {
  /** Short-lived JWT from POST /public/store/:slug/otp/verify, proves the buyer's phone ownership. */
  @IsString()
  orderToken!: string;
}
