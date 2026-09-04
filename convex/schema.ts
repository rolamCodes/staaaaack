import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  players: defineTable({
    handle: v.string(),
    handleLower: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    sessionTokenHash: v.string(),
    onboarded: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_handle", ["handleLower"])
    .index("by_session", ["sessionTokenHash"]),

  runs: defineTable({
    playerId: v.id("players"),
    dayId: v.string(),
    score: v.number(),
    theme: v.string(),
    finishedAt: v.number(),
  })
    .index("by_score", ["score"])
    .index("by_player_and_day", ["playerId", "dayId"])
    .index("by_finished", ["finishedAt"]),

  matches: defineTable({
    code: v.string(),
    dayId: v.string(),
    theme: v.string(),
    words: v.array(v.string()),
    hostId: v.id("players"),
    guestId: v.optional(v.id("players")),
    stack: v.array(v.string()),
    rebuildAt: v.number(),
    status: v.union(
      v.literal("waiting"),
      v.literal("p2_add"),
      v.literal("p1_add"),
      v.literal("p2_turn"),
      v.literal("p1_turn"),
      v.literal("over")
    ),
    endurance: v.boolean(),
    score: v.number(),
    winnerId: v.optional(v.id("players")),
    p1LeftMs: v.number(),
    p2LeftMs: v.number(),
    turnStartedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_host", ["hostId"]),
});
