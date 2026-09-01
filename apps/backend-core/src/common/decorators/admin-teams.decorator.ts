import { SetMetadata } from '@nestjs/common';
import type { StaffTeam } from '../../../generated/control-client/index.js';

export const ADMIN_TEAMS_KEY = 'adminTeams';

/** Restricts an admin-backoffice route to the given internal staff teams. */
export const AdminTeams = (...teams: StaffTeam[]) => SetMetadata(ADMIN_TEAMS_KEY, teams);
