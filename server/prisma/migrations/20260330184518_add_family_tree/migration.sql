-- CreateTable
CREATE TABLE "FamilyTree" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FamilyTree_pkey" PRIMARY KEY ("id")
);

-- Insert seed Demo Tree with a known ID
INSERT INTO "FamilyTree" ("id", "name") VALUES ('demo-tree-seed-id', 'Demo Tree');

-- Add treeId column with a temporary default pointing to Demo Tree
ALTER TABLE "Person" ADD COLUMN "treeId" TEXT NOT NULL DEFAULT 'demo-tree-seed-id';

-- Add foreign key constraint
ALTER TABLE "Person" ADD CONSTRAINT "Person_treeId_fkey"
    FOREIGN KEY ("treeId") REFERENCES "FamilyTree"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop the default — new rows must supply treeId explicitly
ALTER TABLE "Person" ALTER COLUMN "treeId" DROP DEFAULT;
