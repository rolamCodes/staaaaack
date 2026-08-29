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

export const leaderboard = query({
  args: {},
  returns: v.array(
    v.object({
      handle: v.string(),
      score: v.number(),
      theme: v.string(),
    })
  ),
  handler: async (ctx) => {
    const runs = await ctx.db.query("runs").withIndex("by_score").order("desc").take(200);

    runs.sort((a, b) => b.score - a.score || a.finishedAt - b.finishedAt);

    const rows = [];
    for (const run of runs.slice(0, 50)) {
      const player = await ctx.db.get(run.playerId);
      if (!player) continue;
      rows.push({
        handle: player.handle,
        score: run.score,
        theme: run.theme,
      });
    }
    return rows;
  },
});
