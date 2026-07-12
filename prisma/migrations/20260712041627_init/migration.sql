-- CreateEnum
CREATE TYPE "TrialStatus" AS ENUM ('PENDING', 'JUDGED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('GUILTY', 'NOT_GUILTY');

-- CreateTable
CREATE TABLE "Trial" (
    "id" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "reason" TEXT,
    "imageUrl" TEXT,
    "status" "TrialStatus" NOT NULL DEFAULT 'PENDING',
    "verdict" "Verdict",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trial_pkey" PRIMARY KEY ("id")
);
