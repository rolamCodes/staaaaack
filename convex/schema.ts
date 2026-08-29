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
});
