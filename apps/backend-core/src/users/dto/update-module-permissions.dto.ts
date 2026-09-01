import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';

class ModulePermissionEntryDto {
  @IsString()
  moduleCode!: string;

  @IsBoolean()
  canViewAll!: boolean;

  @IsBoolean()
  canViewOwn!: boolean;

  @IsBoolean()
  canCreate!: boolean;

  @IsBoolean()
  canEdit!: boolean;

  @IsBoolean()
  canDelete!: boolean;
}

export class UpdateModulePermissionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModulePermissionEntryDto)
  entries!: ModulePermissionEntryDto[];
}
