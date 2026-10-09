import { config } from "../server/src/config.js";
import { db } from "../server/src/db.js";
import { achievementCodes } from "../server/src/engine.js";
if (config.NODE_ENV === "production")
  throw new Error("Development seed is forbidden in production");
for (const code of achievementCodes)
  await db.achievement.upsert({
    where: { code },
    create: { code },
    update: {},
  });
for (const id of ["1", "2"])
  await db.user.upsert({
    where: { telegramId: id },
    create: { telegramId: id, firstName: `Local Player ${id}` },
    update: {},
  });
await db.$disconnect();
console.log(
  "Local players and achievements seeded. No fake production data created.",
);
