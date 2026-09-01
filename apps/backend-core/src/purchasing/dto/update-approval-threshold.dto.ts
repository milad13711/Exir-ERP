import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateApprovalThresholdDto {
  /** null/omitted disables the approval requirement — every order auto-approves. */
  @IsOptional()
  @IsInt()
  @Min(0)
  threshold?: number | null;
}
