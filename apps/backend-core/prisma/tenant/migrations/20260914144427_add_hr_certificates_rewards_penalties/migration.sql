-- CreateTable
CREATE TABLE "hr_certificates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "recipientNameFa" TEXT NOT NULL,
    "recipientNameEn" TEXT,
    "courseTitleFa" TEXT NOT NULL,
    "courseTitleEn" TEXT,
    "durationHours" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "score" INTEGER,
    "issuedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_personnel_rewards" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" INTEGER,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_personnel_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_personnel_penalties" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" INTEGER,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_personnel_penalties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_certificates_code_key" ON "hr_certificates"("code");

-- CreateIndex
CREATE INDEX "hr_certificates_employeeId_idx" ON "hr_certificates"("employeeId");

-- CreateIndex
CREATE INDEX "hr_personnel_rewards_employeeId_idx" ON "hr_personnel_rewards"("employeeId");

-- CreateIndex
CREATE INDEX "hr_personnel_penalties_employeeId_idx" ON "hr_personnel_penalties"("employeeId");

-- AddForeignKey
ALTER TABLE "hr_certificates" ADD CONSTRAINT "hr_certificates_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_certificates" ADD CONSTRAINT "hr_certificates_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_personnel_rewards" ADD CONSTRAINT "hr_personnel_rewards_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_personnel_rewards" ADD CONSTRAINT "hr_personnel_rewards_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_personnel_penalties" ADD CONSTRAINT "hr_personnel_penalties_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_personnel_penalties" ADD CONSTRAINT "hr_personnel_penalties_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
