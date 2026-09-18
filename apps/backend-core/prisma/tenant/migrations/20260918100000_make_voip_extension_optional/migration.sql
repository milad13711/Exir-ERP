-- The settings UI now only exposes the direct IP-phone (SIP) connection,
-- not the webhook call-popup extension, so a user saving their SIP
-- username/password alone must not be blocked by a NOT NULL extension.
ALTER TABLE "voip_extensions" ALTER COLUMN "extension" DROP NOT NULL;
