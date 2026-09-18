-- Dynamic contract-template merge fields (second party's free-text legal
-- info, plus arbitrary custom placeholder values entered per contract) and
-- a marker for when the company side was signed by a delegate rather than
-- the tenant owner, so documents can show "از طرف …" next to the stamp.
ALTER TABLE "contracts" ADD COLUMN "secondPartyNationalId" TEXT;
ALTER TABLE "contracts" ADD COLUMN "secondPartyRegistrationNumber" TEXT;
ALTER TABLE "contracts" ADD COLUMN "secondPartyAddress" TEXT;
ALTER TABLE "contracts" ADD COLUMN "customFieldValues" JSONB;
ALTER TABLE "contracts" ADD COLUMN "partyBSignedAsDelegate" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "contract_amendments" ADD COLUMN "partyBSignedAsDelegate" BOOLEAN NOT NULL DEFAULT false;
