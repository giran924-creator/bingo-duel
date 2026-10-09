-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('WAITING', 'ACTIVE', 'PAUSED', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BoardMode" AS ENUM ('RANDOM', 'MANUAL');

-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('FRIEND', 'QUICK');

-- CreateEnum
CREATE TYPE "GameResult" AS ENUM ('WIN', 'DRAW', 'FORFEIT', 'ABANDONED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "photoUrl" TEXT,
    "languageCode" TEXT NOT NULL DEFAULT 'uz',
    "rating" INTEGER NOT NULL DEFAULT 1000,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "currentWinStreak" INTEGER NOT NULL DEFAULT 0,
    "bestWinStreak" INTEGER NOT NULL DEFAULT 0,
    "totalLines" INTEGER NOT NULL DEFAULT 0,
    "totalTurns" INTEGER NOT NULL DEFAULT 0,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "bannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "publicCode" TEXT NOT NULL,
    "type" "GameType" NOT NULL,
    "boardMode" "BoardMode" NOT NULL DEFAULT 'RANDOM',
    "status" "GameStatus" NOT NULL DEFAULT 'WAITING',
    "numberMin" INTEGER NOT NULL DEFAULT 1,
    "numberMax" INTEGER NOT NULL DEFAULT 40,
    "boardSize" INTEGER NOT NULL DEFAULT 5,
    "winLines" INTEGER NOT NULL DEFAULT 5,
    "diagonalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rulesVersion" TEXT NOT NULL DEFAULT '1.0',
    "currentPlayerId" TEXT,
    "firstPlayerId" TEXT,
    "winnerId" TEXT,
    "result" "GameResult",
    "rematchRequestedBy" TEXT,
    "rematchGameId" TEXT,
    "pausedAt" TIMESTAMP(3),
    "turnDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePlayer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "ratingBefore" INTEGER,
    "ratingAfter" INTEGER,
    "ratingDelta" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamePlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "gamePlayerId" TEXT NOT NULL,
    "cells" INTEGER[],
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "code" TEXT NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("userId","code")
);

-- CreateTable
CREATE TABLE "MatchmakingEntry" (
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchmakingEntry_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "DailyActivity" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "DailyActivity_pkey" PRIMARY KEY ("userId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "User_rating_id_idx" ON "User"("rating" DESC, "id");

-- CreateIndex
CREATE INDEX "User_wins_id_idx" ON "User"("wins" DESC, "id");

-- CreateIndex
CREATE INDEX "User_bestWinStreak_id_idx" ON "User"("bestWinStreak" DESC, "id");

-- CreateIndex
CREATE INDEX "User_gamesPlayed_id_idx" ON "User"("gamesPlayed" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "Game_publicCode_key" ON "Game"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "Game_rematchGameId_key" ON "Game"("rematchGameId");

-- CreateIndex
CREATE INDEX "Game_status_updatedAt_idx" ON "Game"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Game_createdAt_type_idx" ON "Game"("createdAt", "type");

-- CreateIndex
CREATE INDEX "GamePlayer_userId_joinedAt_idx" ON "GamePlayer"("userId", "joinedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "GamePlayer_gameId_userId_key" ON "GamePlayer"("gameId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GamePlayer_gameId_seat_key" ON "GamePlayer"("gameId", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "Board_gamePlayerId_key" ON "Board"("gamePlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_gameId_number_key" ON "Turn"("gameId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_gameId_turnIndex_key" ON "Turn"("gameId", "turnIndex");

-- CreateIndex
CREATE INDEX "MatchmakingEntry_createdAt_idx" ON "MatchmakingEntry"("createdAt");

-- CreateIndex
CREATE INDEX "DailyActivity_day_idx" ON "DailyActivity"("day");

-- AddForeignKey
ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_gamePlayerId_fkey" FOREIGN KEY ("gamePlayerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_code_fkey" FOREIGN KEY ("code") REFERENCES "Achievement"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchmakingEntry" ADD CONSTRAINT "MatchmakingEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
