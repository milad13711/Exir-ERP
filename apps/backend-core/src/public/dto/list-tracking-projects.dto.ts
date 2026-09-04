import { IsString } from 'class-validator';

export class ListTrackingProjectsDto {
  /** Short-lived JWT from POST /public/tracking/:slug/otp/verify, proves phone ownership. */
  @IsString()
  trackingToken!: string;
}
