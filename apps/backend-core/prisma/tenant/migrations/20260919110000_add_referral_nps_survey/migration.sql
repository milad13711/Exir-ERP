-- نظرسنجی دوره‌ای رضایت از پشتیبانی نماینده — بدون OTP، مثل mentoring_session_surveys.

CREATE TABLE "referral_nps_surveys" (
    "id" TEXT NOT NULL,
    "referralConversionId" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "rating" INTEGER,
    "note" TEXT,
    "sentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_nps_surveys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "referral_nps_surveys_publicToken_key" ON "referral_nps_surveys"("publicToken");
CREATE INDEX "referral_nps_surveys_referralConversionId_idx" ON "referral_nps_surveys"("referralConversionId");

ALTER TABLE "referral_nps_surveys" ADD CONSTRAINT "referral_nps_surveys_referralConversionId_fkey" FOREIGN KEY ("referralConversionId") REFERENCES "referral_conversions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
