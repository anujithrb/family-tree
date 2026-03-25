-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birth" INTEGER NOT NULL,
    "death" INTEGER,
    "gender" TEXT NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Couple" (
    "id" TEXT NOT NULL,
    "spouseAId" TEXT NOT NULL,
    "spouseBId" TEXT NOT NULL,

    CONSTRAINT "Couple_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoupleChild" (
    "coupleId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CoupleChild_pkey" PRIMARY KEY ("coupleId","childId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Couple_spouseAId_key" ON "Couple"("spouseAId");

-- CreateIndex
CREATE UNIQUE INDEX "Couple_spouseBId_key" ON "Couple"("spouseBId");

-- AddForeignKey
ALTER TABLE "Couple" ADD CONSTRAINT "Couple_spouseAId_fkey" FOREIGN KEY ("spouseAId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Couple" ADD CONSTRAINT "Couple_spouseBId_fkey" FOREIGN KEY ("spouseBId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoupleChild" ADD CONSTRAINT "CoupleChild_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoupleChild" ADD CONSTRAINT "CoupleChild_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
