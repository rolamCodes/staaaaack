import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Helper to generate random hex string (for session tokens)
function generateRandomToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

// Simple hash for session tokens (for lookup only)
function hashSessionToken(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// Simple password hashing (for demo - in production use PBKDF2 in an action)
async function hashPassword(
  password: string,
  salt: string
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const claimHandle = mutation({
  args: {
    handle: v.string(),
    password: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    token: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Validate handle
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(args.handle)) {
      return {
        success: false,
        error: "Handle must be 3-16 chars, alphanumeric and underscore only",
      };
    }

    // Validate passphrase
    if (args.password.length < 6) {
      return {
        success: false,
        error: "Passphrase must be at least 6 characters",
      };
    }

    const handleLower = args.handle.toLowerCase();

    // Check if handle exists (case-insensitive)
    const existing = await ctx.db
      .query("players")
      .withIndex("by_handle", (q) => q.eq("handleLower", handleLower))
      .first();

    if (existing) {
      return {
        success: false,
        error: "Handle already taken",
      };
    }

    // Generate salt and hash password
    const salt = generateRandomToken();
    const passwordHash = await hashPassword(args.password, salt);

    // Generate session token
    const sessionToken = generateRandomToken();
    const sessionTokenHash = hashSessionToken(sessionToken);

    // Create player
    await ctx.db.insert("players", {
      handle: args.handle,
      handleLower,
      passwordHash,
      passwordSalt: salt,
      sessionTokenHash,
      onboarded: false,
      createdAt: Date.now(),
    });

    return {
      success: true,
      token: sessionToken,
    };
  },
});

export const signIn = mutation({
  args: {
    handle: v.string(),
    password: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    token: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const handleLower = args.handle.toLowerCase();

    // Find player
    const player = await ctx.db
      .query("players")
      .withIndex("by_handle", (q) => q.eq("handleLower", handleLower))
      .first();

    if (!player) {
      return {
        success: false,
        error: "Invalid handle or passphrase",
      };
    }

    // Verify password
    const passwordHash = await hashPassword(args.password, player.passwordSalt);

    if (passwordHash !== player.passwordHash) {
      return {
        success: false,
        error: "Invalid handle or passphrase",
      };
    }

    // Generate new session token
    const sessionToken = generateRandomToken();
    const sessionTokenHash = hashSessionToken(sessionToken);

    // Update session token
    await ctx.db.patch(player._id, { sessionTokenHash });

    return {
      success: true,
      token: sessionToken,
    };
  },
});

export const getMe = query({
  args: {
    sessionToken: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("players"),
      handle: v.string(),
      onboarded: v.boolean(),
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

    return {
      _id: player._id,
      handle: player.handle,
      onboarded: player.onboarded,
    };
  },
});

export const completeOnboarding = mutation({
  args: {
    sessionToken: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const sessionTokenHash = hashSessionToken(args.sessionToken);

    const player = await ctx.db
      .query("players")
      .withIndex("by_session", (q) => q.eq("sessionTokenHash", sessionTokenHash))
      .first();

    if (!player) {
      throw new Error("Not authenticated");
    }

    await ctx.db.patch(player._id, { onboarded: true });

    return { success: true };
  },
});
