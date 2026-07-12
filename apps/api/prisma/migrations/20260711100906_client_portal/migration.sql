-- CreateEnum
CREATE TYPE "ClientOrgStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ClientAccessLevel" AS ENUM ('VIEWER', 'APPROVER');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "clientOrgId" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "clientOrgId" UUID;

-- CreateTable
CREATE TABLE "client_orgs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ClientOrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_project_access" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "clientUserId" UUID NOT NULL,
    "level" "ClientAccessLevel" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_project_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_orgs_name_key" ON "client_orgs"("name");

-- CreateIndex
CREATE INDEX "client_project_access_clientUserId_idx" ON "client_project_access"("clientUserId");

-- CreateIndex
CREATE UNIQUE INDEX "client_project_access_projectId_clientUserId_key" ON "client_project_access"("projectId", "clientUserId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_clientOrgId_fkey" FOREIGN KEY ("clientOrgId") REFERENCES "client_orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_clientOrgId_fkey" FOREIGN KEY ("clientOrgId") REFERENCES "client_orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_project_access" ADD CONSTRAINT "client_project_access_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_project_access" ADD CONSTRAINT "client_project_access_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
