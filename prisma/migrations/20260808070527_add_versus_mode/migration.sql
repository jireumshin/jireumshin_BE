-- CreateEnum
CREATE TYPE "TrialMode" AS ENUM ('SINGLE', 'VERSUS');

-- CreateEnum
CREATE TYPE "VersusResult" AS ENUM ('A', 'B', 'NEITHER');

-- AlterTable
ALTER TABLE "Trial" ADD COLUMN     "gaugesB" JSONB,
ADD COLUMN     "imageUrlB" TEXT,
ADD COLUMN     "itemNameB" TEXT,
ADD COLUMN     "juryB" JSONB,
ADD COLUMN     "mode" "TrialMode" NOT NULL DEFAULT 'SINGLE',
ADD COLUMN     "priceB" INTEGER,
ADD COLUMN     "reasonB" TEXT,
ADD COLUMN     "versusResult" "VersusResult";

-- AlterTable
ALTER TABLE "TrialMessage" ADD COLUMN     "target" TEXT;
