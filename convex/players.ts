import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { hashSessionToken } from "./lib/session";
import { getTodayInfo } from "./lists";

export const insertPlayer = internalMutation({
  args: {
    handle: v.string(),
    handleLower: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    sessionTokenHash: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), error: v.string() })
  ),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("players")
      .withIndex("by_handle", (q) => q.eq("handleLower", args.handleLower))
      .unique();

    if (existing) {
      return { ok: false as const, error: "Handle already taken" };
    }

    await ctx.db.insert("players", {
      handle: args.handle,
      handleLower: args.handleLower,
      passwordHash: args.passwordHash,
      passwordSalt: args.passwordSalt,
      sessionTokenHash: args.sessionTokenHash,
      onboarded: false,
      createdAt: Date.now(),
    });

    return { ok: true as const };
  },
});

export const getAuthByHandle = internalQuery({
  args: { handleLower: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("players"),
      passwordHash: v.string(),
      passwordSalt: v.string(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const player = await ctx.db
      .query("players")
      .withIndex("by_handle", (q) => q.eq("handleLower", args.handleLower))
      .unique();

    if (!player) return null;
    return {
      _id: player._id,
      passwordHash: player.passwordHash,
      passwordSalt: player.passwordSalt,
    };
  },
});

export const setSession = internalMutation({
  args: {
    playerId: v.id("players"),
    sessionTokenHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.playerId, {
      sessionTokenHash: args.sessionTokenHash,
    });
    return null;
  },
});

export const getMe = query({
  args: { sessionToken: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("players"),
      handle: v.string(),
      onboarded: v.boolean(),
      todaySubmitted: v.boolean(),
      todayScore: v.optional(v.number()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const sessionTokenHash = await hashSessionToken(args.sessionToken);
    const player = await ctx.db
      .query("players")
      .withIndex("by_session", (q) =>
        q.eq("sessionTokenHash", sessionTokenHash)
      )
      .unique();

    if (!player) return null;

    const { dayId } = getTodayInfo();
    const run = await ctx.db
      .query("runs")
      .withIndex("by_player_and_day", (q) =>
        q.eq("playerId", player._id).eq("dayId", dayId)
      )
      .unique();

    return {
      _id: player._id,
      handle: player.handle,
      onboarded: player.onboarded,
      todaySubmitted: Boolean(run),
      todayScore: run ? run.score : undefined,
    };
  },
});

export const completeOnboarding = mutation({
  args: { sessionToken: v.string() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const sessionTokenHash = await hashSessionToken(args.sessionToken);
    const player = await ctx.db
      .query("players")
      .withIndex("by_session", (q) =>
        q.eq("sessionTokenHash", sessionTokenHash)
      )
      .unique();

    if (!player) {
      throw new Error("Not authenticated");
    }

    await ctx.db.patch(player._id, { onboarded: true });
    return { success: true };
  },
});
