-- AlterTable
ALTER TABLE "Trial" ADD COLUMN     "followUpDueAt" TIMESTAMP(3),
ADD COLUMN     "followedUpAt" TIMESTAMP(3),
ADD COLUMN     "purchased" BOOLEAN,
ADD COLUMN     "regret" BOOLEAN;
