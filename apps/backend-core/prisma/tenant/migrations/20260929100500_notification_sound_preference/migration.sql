-- Notifications: per-user toggle for the in-app bell sound — additive, defaults to on.
ALTER TABLE "notification_preferences" ADD COLUMN "soundEnabled" BOOLEAN NOT NULL DEFAULT true;
