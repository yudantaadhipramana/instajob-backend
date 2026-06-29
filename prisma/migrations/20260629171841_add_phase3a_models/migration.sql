-- CreateTable
CREATE TABLE "BotConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "botType" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'config_1',
    "configData" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BotConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BotStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "botType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "uptimeSeconds" INTEGER NOT NULL DEFAULT 0,
    "jobsProcessed" INTEGER NOT NULL DEFAULT 0,
    "applicationsSent" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "metricsJson" TEXT NOT NULL DEFAULT '{}',
    "lastUpdate" DATETIME NOT NULL,
    CONSTRAINT "BotStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BotConfig_userId_idx" ON "BotConfig"("userId");

-- CreateIndex
CREATE INDEX "BotConfig_botType_idx" ON "BotConfig"("botType");

-- CreateIndex
CREATE UNIQUE INDEX "BotStatus_processId_key" ON "BotStatus"("processId");

-- CreateIndex
CREATE INDEX "BotStatus_userId_idx" ON "BotStatus"("userId");

-- CreateIndex
CREATE INDEX "BotStatus_status_idx" ON "BotStatus"("status");
