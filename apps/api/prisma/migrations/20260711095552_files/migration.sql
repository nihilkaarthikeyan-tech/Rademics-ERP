-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING', 'SCANNING', 'AVAILABLE', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('INTERNAL', 'CLIENT_VISIBLE');

-- CreateTable
CREATE TABLE "file_assets" (
    "id" UUID NOT NULL,
    "taskId" UUID,
    "profileUserId" UUID,
    "displayName" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_versions" (
    "id" UUID NOT NULL,
    "fileAssetId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "contentType" TEXT,
    "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanDetail" TEXT,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'INTERNAL',
    "note" TEXT,
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_assets_taskId_idx" ON "file_assets"("taskId");

-- CreateIndex
CREATE INDEX "file_assets_profileUserId_idx" ON "file_assets"("profileUserId");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_storageKey_key" ON "file_versions"("storageKey");

-- CreateIndex
CREATE INDEX "file_versions_fileAssetId_idx" ON "file_versions"("fileAssetId");

-- CreateIndex
CREATE INDEX "file_versions_scanStatus_idx" ON "file_versions"("scanStatus");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_fileAssetId_versionNumber_key" ON "file_versions"("fileAssetId", "versionNumber");

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_profileUserId_fkey" FOREIGN KEY ("profileUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "file_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
