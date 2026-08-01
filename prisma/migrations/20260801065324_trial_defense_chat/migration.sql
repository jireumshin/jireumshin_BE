-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'JUROR');

-- AlterTable
ALTER TABLE "Trial" ADD COLUMN     "defenseClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "defenseRounds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gauges" JSONB;

-- CreateTable
CREATE TABLE "TrialMessage" (
    "id" TEXT NOT NULL,
    "trialId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "juror" TEXT,
    "emoji" TEXT,
    "content" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrialMessage_trialId_idx" ON "TrialMessage"("trialId");

-- AddForeignKey
ALTER TABLE "TrialMessage" ADD CONSTRAINT "TrialMessage_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "Trial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
