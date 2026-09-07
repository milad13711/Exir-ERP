import { IsIn } from 'class-validator';

export class UpdateReviewStatusDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';
}
