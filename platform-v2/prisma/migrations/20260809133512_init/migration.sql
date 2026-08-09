-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('TEXT', 'NUMBER', 'PARAGRAPH', 'SCALE', 'MULTIPLE_CHOICE');

-- CreateEnum
CREATE TYPE "ReportPeriod" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'sent', 'failed', 'suppressed');

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT NOT NULL,
    "sector" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "formToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProfileField" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ClientProfileField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomQuestion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "choices" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataDate" DATE NOT NULL,
    "revenue" DECIMAL(14,2),
    "operationsCount" INTEGER,
    "cost" DECIMAL(14,2),
    "newClients" INTEGER,
    "repeatClients" INTEGER,
    "marketingSpend" DECIMAL(14,2),
    "satisfaction" INTEGER,
    "topItem" TEXT,
    "sectorIndicator" TEXT,
    "notes" TEXT,
    "customAnswers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodType" "ReportPeriod" NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "aiSummary" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceEntry" (
    "id" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "activeClients" INTEGER,
    "reportsSentToday" INTEGER,
    "clientIssues" TEXT,
    "newLeadsContacted" INTEGER,
    "seriousMeetings" INTEGER,
    "newContracts" TEXT,
    "revenueCollected" DECIMAL(14,2),
    "expensesToday" DECIMAL(14,2),
    "pendingReceivables" DECIMAL(14,2),
    "tasksCompleted" TEXT,
    "operationalBlockers" TEXT,
    "decisionsToday" TEXT,
    "risksNotes" TEXT,
    "selfRating" INTEGER,
    "tomorrowPlan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Client_formToken_key" ON "Client"("formToken");

-- CreateIndex
CREATE INDEX "Client_active_idx" ON "Client"("active");

-- CreateIndex
CREATE INDEX "ClientProfileField_clientId_idx" ON "ClientProfileField"("clientId");

-- CreateIndex
CREATE INDEX "CustomQuestion_clientId_idx" ON "CustomQuestion"("clientId");

-- CreateIndex
CREATE INDEX "DailyEntry_clientId_dataDate_idx" ON "DailyEntry"("clientId", "dataDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyEntry_clientId_dataDate_key" ON "DailyEntry"("clientId", "dataDate");

-- CreateIndex
CREATE INDEX "Report_clientId_periodType_idx" ON "Report"("clientId", "periodType");

-- CreateIndex
CREATE UNIQUE INDEX "Report_clientId_periodType_periodLabel_key" ON "Report"("clientId", "periodType", "periodLabel");

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceEntry_entryDate_key" ON "GovernanceEntry"("entryDate");

-- AddForeignKey
ALTER TABLE "ClientProfileField" ADD CONSTRAINT "ClientProfileField_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomQuestion" ADD CONSTRAINT "CustomQuestion_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyEntry" ADD CONSTRAINT "DailyEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
