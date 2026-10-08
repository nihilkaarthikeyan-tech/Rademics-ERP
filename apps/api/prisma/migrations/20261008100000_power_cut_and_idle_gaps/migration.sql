-- CreateEnum
CREATE TYPE "RegularizationKind" AS ENUM ('CORRECTION', 'POWER_CUT');

-- AlterTable
ALTER TABLE "regularization_requests" ADD COLUMN     "idleCreditedSeconds" INTEGER,
ADD COLUMN     "kind" "RegularizationKind" NOT NULL DEFAULT 'CORRECTION';

-- CreateTable
CREATE TABLE "attendance_idle_gaps" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "seconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_idle_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_idle_gaps_userId_startAt_idx" ON "attendance_idle_gaps"("userId", "startAt");

-- CreateIndex
CREATE INDEX "attendance_idle_gaps_sessionId_idx" ON "attendance_idle_gaps"("sessionId");

-- AddForeignKey
ALTER TABLE "attendance_idle_gaps" ADD CONSTRAINT "attendance_idle_gaps_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

