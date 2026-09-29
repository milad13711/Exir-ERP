import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VAULT_EDIT_KEY = 'requireVaultEdit';

/**
 * Marks a route as needing not just a valid vault ticket (see VaultTicketGuard)
 * but one whose canEdit flag is true — used on the update/delete document
 * routes. View-only routes (list/detail) only need @UseGuards(VaultTicketGuard)
 * with no edit requirement.
 */
export const RequireVaultEdit = () => SetMetadata(REQUIRE_VAULT_EDIT_KEY, true);
