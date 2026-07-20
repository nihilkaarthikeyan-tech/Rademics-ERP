-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('WEB', 'DESKTOP');

-- AlterTable
ALTER TABLE "attendance_sessions" ADD COLUMN     "source" "AttendanceSource" NOT NULL DEFAULT 'WEB';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "desktopCheckInRequired" BOOLEAN NOT NULL DEFAULT false;
