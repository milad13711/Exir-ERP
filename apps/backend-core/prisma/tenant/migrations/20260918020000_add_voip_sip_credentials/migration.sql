-- Adds per-user SIP registration credentials so an IP phone / softphone
-- can register directly against the tenant's PBX (e.g. Navatel), separate
-- from the short `extension` used only to match inbound-call webhooks.
ALTER TABLE "voip_extensions" ADD COLUMN "sipUsername" TEXT;
ALTER TABLE "voip_extensions" ADD COLUMN "sipPassword" TEXT;
