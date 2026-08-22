-- AlterTable
ALTER TABLE "Trial" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TrialLike" (
    "id" TEXT NOT NULL,
    "trialId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrialLike_userId_idx" ON "TrialLike"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrialLike_trialId_userId_key" ON "TrialLike"("trialId", "userId");

-- CreateIndex
CREATE INDEX "Trial_isPublic_publishedAt_idx" ON "Trial"("isPublic", "publishedAt");

-- AddForeignKey
ALTER TABLE "TrialLike" ADD CONSTRAINT "TrialLike_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "Trial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrialLike" ADD CONSTRAINT "TrialLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
