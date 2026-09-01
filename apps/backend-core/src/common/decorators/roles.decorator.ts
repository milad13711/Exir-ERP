import { SetMetadata } from '@nestjs/common';
import type { TenantRole } from '../../../generated/control-client/index.js';

export const ROLES_KEY = 'roles';

/** Restricts a tenant-scoped route to the given coarse membership roles. */
export const Roles = (...roles: TenantRole[]) => SetMetadata(ROLES_KEY, roles);
