import { db } from "./db.js";
import { publicUser } from "./games.js";
import { requireCondition } from "./errors.js";
import type { StatsView } from "../../shared/types.js";
export const sortFields = [
  "rating",
  "bestWinStreak",
  "gamesPlayed",
  "wins",
] as const;
export type SortField = (typeof sortFields)[number];
export async function rank(id: string, field: SortField = "rating") {
  const u = await db.user.findUnique({ where: { id } });
  requireCondition(u, "USER_NOT_FOUND", 404);
  return (
    1 +
    (await db.user.count({
      where: {
        isBanned: false,
        OR: [
          { [field]: { gt: u[field] } },
          { [field]: u[field], id: { lt: id } },
        ],
      },
    }))
  );
}
export async function profile(id: string): Promise<StatsView> {
  const u = await db.user.findUnique({
    where: { id },
    include: { achievements: { orderBy: { unlockedAt: "desc" } } },
  });
  requireCondition(u, "USER_NOT_FOUND", 404);
  return {
    user: publicUser(u),
    rank: await rank(id),
    winRate: u.gamesPlayed ? Math.round((100 * u.wins) / u.gamesPlayed) : 0,
    averageTurns: u.gamesPlayed
      ? Math.round((u.totalTurns / u.gamesPlayed) * 10) / 10
      : 0,
    achievements: u.achievements.map((a) => ({
      code: a.code,
      unlockedAt: a.unlockedAt.toISOString(),
    })),
  };
}
export async function leaderboard(id: string, field: SortField) {
  const users = await db.user.findMany({
    where: { isBanned: false },
    orderBy: [{ [field]: "desc" }, { id: "asc" }],
    take: 100,
  });
  return {
    players: users.map((u, i) => ({ rank: i + 1, user: publicUser(u) })),
    myRank: await rank(id, field),
  };
}
