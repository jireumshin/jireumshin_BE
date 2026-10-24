-- AlterTable
ALTER TABLE "Trial" ADD COLUMN     "commentCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TrialComment" (
    "id" TEXT NOT NULL,
    "trialId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrialComment_trialId_createdAt_idx" ON "TrialComment"("trialId", "createdAt");

-- CreateIndex
CREATE INDEX "TrialComment_userId_idx" ON "TrialComment"("userId");

-- AddForeignKey
ALTER TABLE "TrialComment" ADD CONSTRAINT "TrialComment_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "Trial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrialComment" ADD CONSTRAINT "TrialComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

