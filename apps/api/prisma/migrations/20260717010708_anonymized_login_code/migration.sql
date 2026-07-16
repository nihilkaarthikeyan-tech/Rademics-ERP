-- AlterTable
ALTER TABLE "users" ADD COLUMN     "loginCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_loginCode_key" ON "users"("loginCode");

