import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { hashSessionToken } from "./lib/session";
import { getTodayInfo } from "./lists";

const MAX_SCORE = 15 * 2 ** 12;

export const getToday = query({
  args: {},
  returns: v.object({
    dayId: v.string(),
    theme: v.string(),
    words: v.array(v.string()),
  }),
  handler: async () => {
    return getTodayInfo();
  },
});

export const submitRun = mutation({
  args: {
    sessionToken: v.string(),
    score: v.number(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const sessionTokenHash = await hashSessionToken(args.sessionToken);
    const player = await ctx.db
      .query("players")
      .withIndex("by_session", (q) =>
        q.eq("sessionTokenHash", sessionTokenHash)
      )
      .unique();

    if (!player) {
      return { success: false, error: "Not authenticated" };
    }

    const today = getTodayInfo();
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_player_and_day", (q) =>
        q.eq("playerId", player._id).eq("dayId", today.dayId)
      )
      .unique();

    if (existing) {
      return { success: false, error: "Already submitted today" };
    }

    const score = Math.min(Math.max(0, Math.floor(args.score)), MAX_SCORE);

    await ctx.db.insert("runs", {
      playerId: player._id,
      dayId: today.dayId,
      score,
      theme: today.theme,
      finishedAt: Date.now(),
    });

    return { success: true };
  },
});

function compareRuns(
  a: { score: number; finishedAt: number },
  b: { score: number; finishedAt: number }
): number {
  return b.score - a.score || a.finishedAt - b.finishedAt;
}

function isBetterRun(
  candidate: { score: number; finishedAt: number },
  current: { score: number; finishedAt: number }
): boolean {
  return compareRuns(candidate, current) < 0;
}

export const leaderboard = query({
  args: {},
  returns: v.array(
    v.object({
      handle: v.string(),
      score: v.number(),
      theme: v.string(),
      finishedAt: v.number(),
    })
  ),
  handler: async (ctx) => {
    const runs = await ctx.db.query("runs").collect();

    const bestByPlayer = new Map<
      (typeof runs)[number]["playerId"],
      (typeof runs)[number]
    >();
    for (const run of runs) {
      const existing = bestByPlayer.get(run.playerId);
      if (!existing || isBetterRun(run, existing)) {
        bestByPlayer.set(run.playerId, run);
      }
    }

    const topRuns = [...bestByPlayer.values()].sort(compareRuns).slice(0, 50);

    const rows = [];
    for (const run of topRuns) {
      const player = await ctx.db.get(run.playerId);
      if (!player) continue;
      rows.push({
        handle: player.handle,
        score: run.score,
        theme: run.theme,
        finishedAt: run.finishedAt,
      });
    }
    return rows;
  },
});
