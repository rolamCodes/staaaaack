import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { hashSessionToken } from "./lib/session";
import { getTodayInfo } from "./lists";

const START_BUDGET_MS = 60_000;
const INCREMENT_MS = 3_000;
const MAX_SCORE = 15 * 2 ** 12;
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

const statusValidator = v.union(
  v.literal("waiting"),
  v.literal("p2_add"),
  v.literal("p1_add"),
  v.literal("p2_turn"),
  v.literal("p1_turn"),
  v.literal("over")
);

const matchView = v.object({
  code: v.string(),
  dayId: v.string(),
  theme: v.string(),
  words: v.array(v.string()),
  hostHandle: v.string(),
  guestHandle: v.union(v.string(), v.null()),
  hostId: v.id("players"),
  guestId: v.union(v.id("players"), v.null()),
  stack: v.array(v.string()),
  rebuildAt: v.number(),
  status: statusValidator,
  endurance: v.boolean(),
  score: v.number(),
  winnerId: v.union(v.id("players"), v.null()),
  p1LeftMs: v.number(),
  p2LeftMs: v.number(),
  turnStartedAt: v.union(v.number(), v.null()),
});

type MatchView = {
  code: string;
  dayId: string;
  theme: string;
  words: string[];
  hostHandle: string;
  guestHandle: string | null;
  hostId: Id<"players">;
  guestId: Id<"players"> | null;
  stack: string[];
  rebuildAt: number;
  status: Doc<"matches">["status"];
  endurance: boolean;
  score: number;
  winnerId: Id<"players"> | null;
  p1LeftMs: number;
  p2LeftMs: number;
  turnStartedAt: number | null;
};

const resultValidator = v.object({
  success: v.boolean(),
  error: v.optional(v.string()),
});

async function requirePlayer(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string
): Promise<Doc<"players">> {
  const sessionTokenHash = await hashSessionToken(sessionToken);
  const player = await ctx.db
    .query("players")
    .withIndex("by_session", (q) => q.eq("sessionTokenHash", sessionTokenHash))
    .unique();
  if (!player) {
    throw new Error("Not authenticated");
  }
  return player;
}

async function matchByCode(
  ctx: QueryCtx | MutationCtx,
  code: string
): Promise<Doc<"matches"> | null> {
  return await ctx.db
    .query("matches")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
}

async function toView(
  ctx: QueryCtx | MutationCtx,
  match: Doc<"matches">
): Promise<MatchView> {
  const host = await ctx.db.get(match.hostId);
  const guest = match.guestId ? await ctx.db.get(match.guestId) : null;
  return {
    code: match.code,
    dayId: match.dayId,
    theme: match.theme,
    words: match.words,
    hostHandle: host?.handle ?? "player",
    guestHandle: guest?.handle ?? null,
    hostId: match.hostId,
    guestId: match.guestId ?? null,
    stack: match.stack,
    rebuildAt: match.rebuildAt,
    status: match.status,
    endurance: match.endurance,
    score: match.score,
    winnerId: match.winnerId ?? null,
    p1LeftMs: match.p1LeftMs,
    p2LeftMs: match.p2LeftMs,
    turnStartedAt: match.turnStartedAt ?? null,
  };
}

function randomCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    const n = Math.floor(Math.random() * CODE_CHARS.length);
    code += CODE_CHARS[n]!;
  }
  return code;
}

function isP1Turn(status: Doc<"matches">["status"]): boolean {
  return status === "p1_add" || status === "p1_turn";
}

function isP2Turn(status: Doc<"matches">["status"]): boolean {
  return status === "p2_add" || status === "p2_turn";
}

function remainingMs(
  stored: number,
  turnStartedAt: number | undefined,
  now: number,
  ticking: boolean
): number {
  if (!ticking || turnStartedAt === undefined) {
    return stored;
  }
  return Math.max(0, stored - (now - turnStartedAt));
}

async function finishMatch(
  ctx: MutationCtx,
  match: Doc<"matches">,
  winnerId: Id<"players">
): Promise<void> {
  await ctx.db.patch(match._id, {
    status: "over",
    winnerId,
    turnStartedAt: undefined,
  });
}

function canAdd(match: Doc<"matches">): boolean {
  if (match.endurance || match.stack.length >= 15) {
    return false;
  }
  if (match.status === "p2_add" || match.status === "p1_add") {
    return true;
  }
  if (match.status === "p2_turn" || match.status === "p1_turn") {
    return match.rebuildAt === match.stack.length;
  }
  return false;
}

function canRebuild(match: Doc<"matches">): boolean {
  if (match.status !== "p2_turn" && match.status !== "p1_turn") {
    return false;
  }
  return match.rebuildAt < match.stack.length;
}

export const create = mutation({
  args: { sessionToken: v.string() },
  returns: v.union(
    v.object({ success: v.literal(true), code: v.string() }),
    v.object({ success: v.literal(false), error: v.string() })
  ),
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.sessionToken);
    const today = getTodayInfo();
    let code = randomCode();
    for (let i = 0; i < 8; i++) {
      const existing = await matchByCode(ctx, code);
      if (!existing) break;
      code = randomCode();
    }
    const clash = await matchByCode(ctx, code);
    if (clash) {
      return { success: false as const, error: "Could not create match" };
    }
    await ctx.db.insert("matches", {
      code,
      dayId: today.dayId,
      theme: today.theme,
      words: today.words,
      hostId: player._id,
      stack: [],
      rebuildAt: 0,
      status: "waiting",
      endurance: false,
      score: 0,
      p1LeftMs: START_BUDGET_MS,
      p2LeftMs: START_BUDGET_MS,
      createdAt: Date.now(),
    });
    return { success: true as const, code };
  },
});

export const get = query({
  args: { code: v.string() },
  returns: v.union(matchView, v.null()),
  handler: async (ctx, args) => {
    const match = await matchByCode(ctx, args.code);
    if (!match) return null;
    return await toView(ctx, match);
  },
});

export const join = mutation({
  args: { sessionToken: v.string(), code: v.string() },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.sessionToken);
    const match = await matchByCode(ctx, args.code);
    if (!match) {
      return { success: false, error: "Match not found" };
    }
    if (match.hostId === player._id) {
      return { success: true };
    }
    if (match.guestId === player._id) {
      return { success: true };
    }
    if (match.status !== "waiting" || match.guestId) {
      return { success: false, error: "Match is full" };
    }
    const now = Date.now();
    await ctx.db.patch(match._id, {
      guestId: player._id,
      status: "p2_add",
      turnStartedAt: now,
    });
    return { success: true };
  },
});

export const addWord = mutation({
  args: {
    sessionToken: v.string(),
    code: v.string(),
    word: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.sessionToken);
    const match = await matchByCode(ctx, args.code);
    if (!match || match.status === "over") {
      return { success: false, error: "Match not found" };
    }
    if (!match.guestId) {
      return { success: false, error: "Waiting for player 2" };
    }
    const p1 = isP1Turn(match.status) && player._id === match.hostId;
    const p2 = isP2Turn(match.status) && player._id === match.guestId;
    if (!p1 && !p2) {
      return { success: false, error: "Not your turn" };
    }
    if (!canAdd(match)) {
      return { success: false, error: "Cannot add now" };
    }
    if (!match.words.includes(args.word) || match.stack.includes(args.word)) {
      return { success: false, error: "Invalid word" };
    }

    const now = Date.now();
    const tickingP1 = isP1Turn(match.status);
    const p1Left = remainingMs(
      match.p1LeftMs,
      match.turnStartedAt,
      now,
      tickingP1
    );
    const p2Left = remainingMs(
      match.p2LeftMs,
      match.turnStartedAt,
      now,
      !tickingP1
    );
    const actorLeft = tickingP1 ? p1Left : p2Left;
    if (actorLeft <= 0) {
      await finishMatch(ctx, match, tickingP1 ? match.guestId : match.hostId);
      return { success: false, error: "Time out" };
    }

    const nextLeft = actorLeft + INCREMENT_MS;
    const stack = [...match.stack, args.word];
    const openingP2 = match.status === "p2_add";
    const openingP1 = match.status === "p1_add";
    let status: Doc<"matches">["status"];
    if (openingP2) {
      status = "p1_add";
    } else if (openingP1) {
      status = "p2_turn";
    } else {
      status = tickingP1 ? "p2_turn" : "p1_turn";
    }

    await ctx.db.patch(match._id, {
      stack,
      rebuildAt: 0,
      status,
      p1LeftMs: tickingP1 ? nextLeft : p1Left,
      p2LeftMs: tickingP1 ? p2Left : nextLeft,
      turnStartedAt: now,
    });
    return { success: true };
  },
});

export const rebuildTap = mutation({
  args: {
    sessionToken: v.string(),
    code: v.string(),
    word: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.sessionToken);
    const match = await matchByCode(ctx, args.code);
    if (!match || match.status === "over") {
      return { success: false, error: "Match not found" };
    }
    if (!match.guestId) {
      return { success: false, error: "Waiting for player 2" };
    }
    const p1 = match.status === "p1_turn" && player._id === match.hostId;
    const p2 = match.status === "p2_turn" && player._id === match.guestId;
    if (!p1 && !p2) {
      return { success: false, error: "Not your turn" };
    }
    if (!canRebuild(match)) {
      return { success: false, error: "Cannot rebuild now" };
    }

    const now = Date.now();
    const tickingP1 = match.status === "p1_turn";
    const p1Left = remainingMs(
      match.p1LeftMs,
      match.turnStartedAt,
      now,
      tickingP1
    );
    const p2Left = remainingMs(
      match.p2LeftMs,
      match.turnStartedAt,
      now,
      !tickingP1
    );
    const actorLeft = tickingP1 ? p1Left : p2Left;
    const opponentId = tickingP1 ? match.guestId : match.hostId;
    if (actorLeft <= 0) {
      await finishMatch(ctx, match, opponentId);
      return { success: false, error: "Time out" };
    }

    const expected = match.stack[match.rebuildAt];
    if (args.word !== expected) {
      await ctx.db.patch(match._id, {
        status: "over",
        winnerId: opponentId,
        p1LeftMs: tickingP1 ? actorLeft : p1Left,
        p2LeftMs: tickingP1 ? p2Left : actorLeft,
        turnStartedAt: undefined,
      });
      return { success: false, error: "Wrong word" };
    }

    const nextLeft = actorLeft + INCREMENT_MS;
    const rebuildAt = match.rebuildAt + 1;
    const finishedRebuild = rebuildAt === match.stack.length;
    const fullFifteen = match.stack.length >= 15;

    if (finishedRebuild && fullFifteen) {
      const nextScore = match.endurance
        ? Math.min(match.score * 2, MAX_SCORE)
        : 15;
      await ctx.db.patch(match._id, {
        rebuildAt: 0,
        status: tickingP1 ? "p2_turn" : "p1_turn",
        endurance: true,
        score: nextScore,
        p1LeftMs: tickingP1 ? nextLeft : p1Left,
        p2LeftMs: tickingP1 ? p2Left : nextLeft,
        turnStartedAt: now,
      });
      return { success: true };
    }

    await ctx.db.patch(match._id, {
      rebuildAt,
      p1LeftMs: tickingP1 ? nextLeft : p1Left,
      p2LeftMs: tickingP1 ? p2Left : nextLeft,
      turnStartedAt: now,
    });
    return { success: true };
  },
});

export const timeout = mutation({
  args: { sessionToken: v.string(), code: v.string() },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx, args.sessionToken);
    const match = await matchByCode(ctx, args.code);
    if (!match || match.status === "over" || match.status === "waiting") {
      return { success: false, error: "Match not found" };
    }
    if (!match.guestId) {
      return { success: false, error: "Waiting for player 2" };
    }
    const isHost = player._id === match.hostId;
    const isGuest = player._id === match.guestId;
    if (!isHost && !isGuest) {
      return { success: false, error: "Not in this match" };
    }
    const now = Date.now();
    const tickingP1 = isP1Turn(match.status);
    const p1Left = remainingMs(
      match.p1LeftMs,
      match.turnStartedAt,
      now,
      tickingP1
    );
    const p2Left = remainingMs(
      match.p2LeftMs,
      match.turnStartedAt,
      now,
      !tickingP1
    );
    if (tickingP1 && p1Left > 0) {
      return { success: false, error: "Time remaining" };
    }
    if (!tickingP1 && p2Left > 0) {
      return { success: false, error: "Time remaining" };
    }
    await finishMatch(ctx, match, tickingP1 ? match.guestId : match.hostId);
    return { success: true };
  },
});
