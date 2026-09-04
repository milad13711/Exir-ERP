import { IsString } from 'class-validator';

export class ContractSignTicketDto {
  /** Short-lived JWT from POST /public/contracts/:slug/:publicToken/otp/verify. */
  @IsString()
  ticket!: string;
}
