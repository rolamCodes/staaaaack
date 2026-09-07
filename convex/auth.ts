"use node";

import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const HANDLE_RE = /^[a-zA-Z0-9_]{3,16}$/;

function hashPassword(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
}

function newSalt(): string {
  return randomBytes(32).toString("hex");
}

function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const claimHandle = action({
  args: {
    handle: v.string(),
    password: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    token: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{ success: boolean; token?: string; error?: string }> => {
    if (!HANDLE_RE.test(args.handle)) {
      return {
        success: false,
        error: "Handle must be 3–16 letters, numbers, or _",
      };
    }
    if (args.password.length < 6) {
      return {
        success: false,
        error: "Password must be at least 6 characters",
      };
    }

    const salt = newSalt();
    const passwordHash = hashPassword(args.password, salt);
    const token = newSessionToken();
    const sessionTokenHash = hashSessionToken(token);

    const inserted: { ok: true } | { ok: false; error: string } =
      await ctx.runMutation(internal.players.insertPlayer, {
      handle: args.handle,
      handleLower: args.handle.toLowerCase(),
      passwordHash,
      passwordSalt: salt,
      sessionTokenHash,
    });

    if (!inserted.ok) {
      return { success: false, error: inserted.error };
    }

    return { success: true, token };
  },
});

export const signIn = action({
  args: {
    handle: v.string(),
    password: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    token: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{ success: boolean; token?: string; error?: string }> => {
    const player = await ctx.runQuery(internal.players.getAuthByHandle, {
      handleLower: args.handle.toLowerCase(),
    });

    if (!player) {
      return { success: false, error: "Invalid handle or password" };
    }

    const passwordHash = hashPassword(args.password, player.passwordSalt);
    if (passwordHash !== player.passwordHash) {
      return { success: false, error: "Invalid handle or password" };
    }

    const token = newSessionToken();
    const sessionTokenHash = hashSessionToken(token);
    await ctx.runMutation(internal.players.setSession, {
      playerId: player._id,
      sessionTokenHash,
    });

    return { success: true, token };
  },
});
