-- AlterTable
ALTER TABLE "Trial" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "Trial_userId_idx" ON "Trial"("userId");

-- AddForeignKey
ALTER TABLE "Trial" ADD CONSTRAINT "Trial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
