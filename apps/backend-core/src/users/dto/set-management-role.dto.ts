import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class SetManagementRoleDto {
  @IsIn(['OWNER', 'ADMIN', 'MEMBER'])
  role!: 'OWNER' | 'ADMIN' | 'MEMBER';

  /** انتقال مدیر کل: نقش OWNER به این کاربر می‌رسد و مالک فعلی به ADMIN تنزل می‌یابد. */
  @IsOptional()
  @IsBoolean()
  transfer?: boolean;
}
