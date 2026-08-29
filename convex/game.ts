import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { dailyLists, LAUNCH_DAY } from "./lists";

// Simple synchronous hashing for session tokens
function hashSessionToken(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

function getDayIndex(): number {
  const now = Date.now();
  const launch = new Date(LAUNCH_DAY).getTime();
  const daysSinceLaunch = Math.floor((now - launch) / (24 * 60 * 60 * 1000));
  return daysSinceLaunch;
}

function getDayId(): string {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

export const getToday = query({
  args: {},
  returns: v.object({
    dayId: v.string(),
    theme: v.string(),
    words: v.array(v.string()),
  }),
  handler: async () => {
    const dayIndex = getDayIndex();
    const list = dailyLists[dayIndex % 100];

    return {
      dayId: getDayId(),
      theme: list.theme,
      words: list.words,
    };
  },
});

export const checkTodaySubmitted = query({
  args: {
    sessionToken: v.string(),
  },
  returns: v.union(
    v.object({
      submitted: v.boolean(),
      run: v.optional(
        v.object({
          score: v.number(),
          theme: v.string(),
        })
      ),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const sessionTokenHash = hashSessionToken(args.sessionToken);

    const player = await ctx.db
      .query("players")
      .withIndex("by_session", (q) => q.eq("sessionTokenHash", sessionTokenHash))
      .first();

    if (!player) {
      return null;
    }

    const dayId = getDayId();
    const existingRun = await ctx.db
      .query("runs")
      .withIndex("by_player_and_day", (q) =>
        q.eq("playerId", player._id).eq("dayId", dayId)
      )
      .first();

    if (existingRun) {
      return {
        submitted: true,
        run: {
          score: existingRun.score,
          theme: existingRun.theme,
        },
      };
    }

    return {
      submitted: false,
    };
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
    const sessionTokenHash = hashSessionToken(args.sessionToken);

    const player = await ctx.db
      .query("players")
      .withIndex("by_session", (q) => q.eq("sessionTokenHash", sessionTokenHash))
      .first();

    if (!player) {
      return {
        success: false,
        error: "Not authenticated",
      };
    }

    // Get today's theme from server
    const dayIndex = getDayIndex();
    const list = dailyLists[dayIndex % 100];
    const dayId = getDayId();

    // Check if already submitted today
    const existingRun = await ctx.db
      .query("runs")
      .withIndex("by_player_and_day", (q) =>
        q.eq("playerId", player._id).eq("dayId", dayId)
      )
      .first();

    if (existingRun) {
      return {
        success: false,
        error: "Already submitted today",
      };
    }

    // Clamp score
    const maxScore = 15 * Math.pow(2, 12);
    const clampedScore = Math.min(Math.max(0, args.score), maxScore);

    // Create run
    await ctx.db.insert("runs", {
      playerId: player._id,
      dayId,
      score: clampedScore,
      theme: list.theme,
      finishedAt: Date.now(),
    });

    return {
      success: true,
    };
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
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_score")
      .order("desc")
      .take(50);

    const result = [];
    for (const run of runs) {
      const player = await ctx.db.get(run.playerId);
      if (player) {
        result.push({
          handle: player.handle,
          score: run.score,
          theme: run.theme,
        });
      }
    }

    return result;
  },
});
