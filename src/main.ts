import "./style.css";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  formatDayId,
  matchCodeFromLocation,
  matchShareUrl,
  setMatchQuery,
} from "./match";

type MatchStatus =
  | "waiting"
  | "p2_add"
  | "p1_add"
  | "p2_turn"
  | "p1_turn"
  | "over";

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
  status: MatchStatus;
  endurance: boolean;
  score: number;
  winnerId: Id<"players"> | null;
  p1LeftMs: number;
  p2LeftMs: number;
  turnStartedAt: number | null;
};

const TOKEN_KEY = "staaaaack-session";
const CIRC = 2 * Math.PI * 15.5;
const START_BUDGET_MS = 60_000;
const INCREMENT_MS = 3_000;
const SHEET_PEEK = 44;
const SHEET_PULL_THRESHOLD = 72;
const WORD_DROP_MS = 340;
const isPlaytest =
  window.location.pathname.replace(/\/+$/, "") === "/playtest";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is missing. Copy .env.example to .env.local.");
}
const convex = new ConvexClient(convexUrl);

const gridEl = document.getElementById("grid")!;
const gridSheetEl = document.getElementById("grid-sheet")!;
const stackEl = document.getElementById("stack")!;
const stackWordsEl = document.getElementById("stack-words")!;
const timerEl = document.getElementById("timer")!;
const timerNum = timerEl.querySelector(".num")!;
const ringSolid = timerEl.querySelector(".ring-solid") as SVGCircleElement;
const endEl = document.getElementById("end")!;
const scoresEl = document.getElementById("scores")!;
const menuButton = document.getElementById("menu-button") as HTMLButtonElement;
const menuBackdrop = document.getElementById("menu-backdrop")!;
const menuPopover = document.getElementById("menu-popover")!;
const menuHandle = document.getElementById("menu-handle")!;
const menuLeaderboard = document.getElementById(
  "menu-leaderboard"
) as HTMLButtonElement;
const menuFeedback = document.getElementById(
  "menu-feedback"
) as HTMLAnchorElement;
const menuSignout = document.getElementById(
  "menu-signout"
) as HTMLButtonElement;
const againBtn = document.getElementById("again") as HTMLButtonElement;
const seeBoardBtn = document.getElementById("see-board") as HTMLButtonElement;
const tomorrowEl = document.getElementById("tomorrow")!;
const playtestNoteEl = document.getElementById("playtest-note")!;
const pvpNoteEl = document.getElementById("pvp-note")!;
const dailyEl = document.getElementById("daily")!;
const dailyDateEl = document.getElementById("daily-date")!;
const dailyThemeEl = document.getElementById("daily-theme")!;
const dailyPvcBtn = document.getElementById("daily-pvc") as HTMLButtonElement;
const dailyPvpBtn = document.getElementById("daily-pvp") as HTMLButtonElement;
const waitEl = document.getElementById("wait")!;
const waitCodeEl = document.getElementById("wait-code")!;
const waitCopyBtn = document.getElementById("wait-copy") as HTMLButtonElement;
const boardRows = document.getElementById("board-rows")!;
const boardEmpty = document.getElementById("board-empty")!;
const gateEl = document.getElementById("gate")!;
const gateForm = document.getElementById("gate-form") as HTMLFormElement;
const gateHandle = document.getElementById("gate-handle") as HTMLInputElement;
const gatePass = document.getElementById("gate-pass") as HTMLInputElement;
const gateError = document.getElementById("gate-error")!;
const gateIn = document.getElementById("gate-in")!;
const guideEl = document.getElementById("guide")!;
const guideGo = document.getElementById("guide-go")!;
const guideTrack = document.getElementById("guide-track")!;
const guideViewport = document.getElementById("guide-viewport")!;
const guideDots = [...document.querySelectorAll("#guide-dots button")];
const menuHowto = document.getElementById("menu-howto") as HTMLButtonElement;
const GUIDE_STEPS = 5;
let guideStep = 0;
let guideBlocking = false;

let sessionToken = localStorage.getItem(TOKEN_KEY);
let currentHandle = "";
let currentPlayerId: Id<"players"> | "" = "";
let words: string[] = [];
let tiles: HTMLButtonElement[] = [];
let stack: string[] = [];
let phase: "add" | "memorize" | "stack" | "over" = "add";
let rebuildAt = 0;
let busy = false;
let score = 0;
let endurance = false;
let endurancePass = 0;
let submittedToday = false;
let lastTodayScore = 0;
let audio: AudioContext | undefined;
let matchCode: string | null = matchCodeFromLocation();
let matchUnsub: (() => void) | null = null;
let matchView: MatchView | null = null;
let pvpMemorize = false;
let pvpWasUnlocked = false;
let pvpTimeoutSent = false;
let renderedStack: string[] = [];

if (isPlaytest) {
  document.title = "staaaaack · playtest";
  playtestNoteEl.hidden = false;
}
const mem = {
  duration: 0,
  left: 0,
  running: false,
  paused: false,
  raf: 0,
  lastSec: 0,
  started: 0,
  onDone: null as null | (() => void),
};

function unused(): string[] {
  const set = new Set(stack);
  return words.filter((w) => !set.has(w));
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

function ensureAudio(): AudioContext {
  if (!audio) {
    audio = new AudioContext();
  }
  if (audio.state === "suspended") void audio.resume();
  return audio;
}

function tone(
  ctx: AudioContext,
  freq: number,
  when: number,
  gain: number,
  dur: number
): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(when);
  o.stop(when + dur + 0.02);
}

function beep(high: boolean): void {
  try {
    const ctx = ensureAudio();
    tone(ctx, high ? 880 : 520, ctx.currentTime, 0.07, 0.1);
  } catch {
    /* ignore autoplay / closed context */
  }
}

function beepIncrement(): void {
  try {
    const ctx = ensureAudio();
    const t = ctx.currentTime;
    tone(ctx, 740, t, 0.08, 0.07);
    tone(ctx, 1175, t + 0.06, 0.09, 0.1);
  } catch {
    /* ignore autoplay / closed context */
  }
}

function overlayBlocksPlay(): boolean {
  return (
    scoresEl.classList.contains("show") ||
    endEl.classList.contains("show") ||
    gateEl.classList.contains("show") ||
    guideEl.classList.contains("show") ||
    dailyEl.classList.contains("show") ||
    waitEl.classList.contains("show")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function collapsedOffset(): number {
  return Math.max(0, gridSheetEl.offsetHeight - SHEET_PEEK);
}

function expandSheet(animated: boolean): void {
  gridSheetEl.classList.remove("collapsed", "pullable", "dragging");
  if (animated) {
    gridSheetEl.style.transition = "transform 320ms cubic-bezier(.2,.7,.2,1)";
    gridSheetEl.style.transform = "translateY(0)";
  } else {
    gridSheetEl.style.transition = "none";
    gridSheetEl.style.transform = "translateY(0)";
    void gridSheetEl.offsetHeight;
    gridSheetEl.style.transition = "";
    gridSheetEl.style.transform = "";
  }
}

function collapseSheet(): void {
  gridSheetEl.classList.add("collapsed", "pullable");
  gridSheetEl.style.transition = "";
  gridSheetEl.style.transform = "";
}

function makeTiles(list: string[]): void {
  gridEl.innerHTML = "";
  tiles = list.map((word) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.textContent = word;
    b.dataset.word = word;
    b.addEventListener("click", () => {
      void onTap(word);
    });
    gridEl.appendChild(b);
    return b;
  });
}

function paintTiles(): void {
  const inStack = new Set(stack);
  const picked = new Set(stack.slice(0, rebuildAt));
  for (const b of tiles) {
    const word = b.dataset.word ?? "";
    b.classList.remove("on", "is-off");
    b.disabled = false;
    if (phase === "add") {
      if (inStack.has(word)) {
        b.classList.add("on", "is-off");
      }
    } else if (phase === "memorize") {
      b.classList.add("is-off");
      if (inStack.has(word)) b.classList.add("on");
    } else if (phase === "stack") {
      if (picked.has(word)) b.classList.add("on");
    } else if (phase === "over") {
      b.classList.add("is-off");
    }
  }
}

function stackShown(): string[] {
  if (phase === "stack") return stack.slice(0, rebuildAt).slice().reverse();
  if (phase === "over") return [];
  return stack.slice().reverse();
}

function renderStack(): void {
  const shown = stackShown();
  const existing = [...stackWordsEl.children].map((el) => el.textContent ?? "");
  if (
    shown.length === existing.length &&
    shown.every((w, i) => w === existing[i])
  ) {
    stackWordsEl.scrollTop = 0;
    return;
  }
  stackWordsEl.innerHTML = "";
  for (const w of shown) {
    const d = document.createElement("div");
    d.className = "word";
    d.textContent = w;
    stackWordsEl.appendChild(d);
  }
  stackWordsEl.scrollTop = 0;
}

async function dropWordOntoStack(word: string): Promise<void> {
  const others = [
    ...stackWordsEl.querySelectorAll<HTMLElement>(":scope > .word"),
  ];
  const firstRects = others.map((el) => el.getBoundingClientRect());
  const prevOverflow = stackWordsEl.style.overflow;
  stackWordsEl.style.overflow = "visible";

  const d = document.createElement("div");
  d.className = "word drop-in";
  d.textContent = word;
  stackWordsEl.prepend(d);

  others.forEach((el, i) => {
    const dy = firstRects[i]!.top - el.getBoundingClientRect().top;
    if (!dy) return;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
  });
  void stackWordsEl.offsetHeight;
  others.forEach((el) => {
    el.style.transition = `transform ${WORD_DROP_MS}ms cubic-bezier(.2,.7,.2,1)`;
    el.style.transform = "none";
  });
  stackWordsEl.scrollTop = 0;
  await sleep(WORD_DROP_MS);
  others.forEach((el) => {
    el.style.transition = "";
    el.style.transform = "";
  });
  d.classList.remove("drop-in");
  stackWordsEl.style.overflow = prevOverflow;
}

function applyStackDismiss(progress: number, animated: boolean): void {
  stackEl.classList.remove("is-memorize");
  const p = Math.max(0, Math.min(1, progress));
  stackEl.style.transition = animated
    ? "transform 320ms cubic-bezier(.2,.7,.2,1), opacity 260ms ease"
    : "none";
  if (p <= 0) {
    stackEl.style.transform = "translateY(0)";
    stackEl.style.opacity = "1";
    return;
  }
  stackEl.style.transform = `translateY(${-(p * 110)}%)`;
  stackEl.style.opacity = String(1 - p);
}

function resetStackMotion(): void {
  stackEl.classList.remove("is-memorize");
  stackEl.style.transition = "none";
  stackEl.style.transform = "";
  stackEl.style.opacity = "";
  void stackEl.offsetHeight;
  stackEl.style.transition = "";
}

function flipShuffle(): Promise<void> {
  const nodes = tiles.slice();
  const first = new Map(nodes.map((el) => [el, el.getBoundingClientRect()]));
  const order = shuffle(nodes);
  order.forEach((el) => gridEl.appendChild(el));
  tiles = order;
  order.forEach((el) => {
    const last = el.getBoundingClientRect();
    const f = first.get(el);
    if (!f) return;
    const dx = f.left - last.left;
    const dy = f.top - last.top;
    if (!dx && !dy) return;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px,${dy}px)`;
  });
  void gridEl.offsetHeight;
  order.forEach((el) => {
    el.style.transition = "transform 480ms cubic-bezier(.2,.7,.2,1)";
    el.style.transform = "none";
  });
  return new Promise((resolve) => {
    setTimeout(() => {
      order.forEach((el) => {
        el.style.transition = "";
        el.style.transform = "";
      });
      resolve();
    }, 500);
  });
}

function setTimerIdle(): void {
  cancelMem();
  timerEl.className = "idle";
  timerNum.textContent = "";
  ringSolid.style.strokeDashoffset = "0";
  timerEl.setAttribute("aria-hidden", "true");
}

function setTimerRun(left: number): void {
  timerEl.className = "run";
  timerNum.textContent = String(Math.max(0, Math.ceil(left / 1000)));
  const p = Math.max(0, Math.min(1, left / START_BUDGET_MS));
  ringSolid.style.strokeDashoffset = String(CIRC * (1 - p));
  timerEl.removeAttribute("aria-hidden");
}

function cancelMem(): void {
  mem.running = false;
  mem.paused = false;
  if (mem.raf) cancelAnimationFrame(mem.raf);
  mem.raf = 0;
}

function startBudgetFrom(left: number, onDone: () => void): void {
  cancelMem();
  mem.onDone = onDone;
  mem.duration = START_BUDGET_MS;
  mem.left = left;
  mem.running = true;
  mem.paused = false;
  mem.started = performance.now();
  mem.lastSec = Math.ceil(mem.left / 1000);
  setTimerRun(mem.left);
  loopMem();
}

function startBudget(): void {
  if (mem.running) return;
  mem.onDone = () => {
    void gameOver();
  };
  mem.duration = START_BUDGET_MS;
  mem.left = START_BUDGET_MS;
  mem.running = true;
  mem.paused = false;
  mem.started = performance.now();
  mem.lastSec = Math.ceil(mem.left / 1000);
  setTimerRun(mem.left);
  beep(false);
  loopMem();
}

function grantIncrement(): void {
  if (!mem.running || phase === "over") return;
  mem.left += INCREMENT_MS;
  mem.lastSec = Math.ceil(mem.left / 1000);
  setTimerRun(mem.left);
  beepIncrement();
}

function loopMem(): void {
  if (!mem.running) return;
  let last = performance.now();
  const step = (now: number) => {
    if (!mem.running) return;
    const dt = now - last;
    last = now;
    if (!mem.paused) {
      mem.left = Math.max(0, mem.left - dt);
    }
    setTimerRun(mem.left);
    const sec = Math.ceil(mem.left / 1000);
    if (sec < mem.lastSec && mem.left > 0) {
      mem.lastSec = sec;
      beep(sec <= 1);
    }
    if (mem.left <= 0) {
      const done = mem.onDone;
      mem.onDone = null;
      cancelMem();
      setTimerIdle();
      if (done) done();
      return;
    }
    mem.raf = requestAnimationFrame(step);
  };
  mem.raf = requestAnimationFrame(step);
}

function pauseMem(): void {
  if (!mem.running || mem.paused) return;
  mem.paused = true;
}

function resumeMem(): void {
  if (!mem.running || !mem.paused) return;
  mem.paused = false;
  mem.lastSec = Math.ceil(mem.left / 1000);
}

function startAdd(): void {
  phase = "add";
  rebuildAt = 0;
  resetStackMotion();
  expandSheet(false);
  paintTiles();
  renderStack();
  busy = false;
  startBudget();
}

async function startMemorize(): Promise<void> {
  phase = "memorize";
  busy = true;
  paintTiles();
  resetStackMotion();
  stackEl.classList.add("is-memorize");
  for (const b of tiles) {
    b.classList.remove("on");
  }
  await flipShuffle();
  if (endEl.classList.contains("show") || phase !== "memorize") return;
  collapseSheet();
}

async function finishMemorize(): Promise<void> {
  if (phase !== "memorize") return;
  if (matchCode) {
    pvpMemorize = false;
    phase = "stack";
    applyStackDismiss(1, true);
    gridSheetEl.classList.remove("collapsed", "pullable", "dragging");
    gridSheetEl.style.transition = "transform 320ms cubic-bezier(.2,.7,.2,1)";
    gridSheetEl.style.transform = "translateY(0)";
    await sleep(320);
    gridSheetEl.style.transition = "";
    gridSheetEl.style.transform = "";
    stackWordsEl.innerHTML = "";
    if (endEl.classList.contains("show")) return;
    rebuildAt = matchView?.rebuildAt ?? 0;
    expandSheet(false);
    renderStack();
    resetStackMotion();
    paintTiles();
    busy = false;
    return;
  }
  phase = "stack";
  applyStackDismiss(1, true);
  gridSheetEl.classList.remove("collapsed", "pullable", "dragging");
  gridSheetEl.style.transition = "transform 320ms cubic-bezier(.2,.7,.2,1)";
  gridSheetEl.style.transform = "translateY(0)";
  await sleep(320);
  gridSheetEl.style.transition = "";
  gridSheetEl.style.transform = "";
  stackWordsEl.innerHTML = "";
  if (endEl.classList.contains("show")) return;
  startRebuild();
}

function startRebuild(): void {
  phase = "stack";
  rebuildAt = 0;
  expandSheet(false);
  renderStack();
  resetStackMotion();
  paintTiles();
  busy = false;
}

async function startEnduranceRound(): Promise<void> {
  phase = "stack";
  rebuildAt = 0;
  busy = true;
  expandSheet(false);
  renderStack();
  resetStackMotion();
  paintTiles();
  await flipShuffle();
  if (endEl.classList.contains("show")) return;
  paintTiles();
  busy = false;
}

async function onMatchTap(word: string): Promise<void> {
  if (!matchCode || !matchView || !sessionToken) return;
  if (pvpMemorize) return;
  const seat = matchSeat(matchView);
  if (!seat || !matchUnlocked(matchView, seat)) return;
  if (matchNeedsRebuild(matchView)) {
    if (matchView.stack[rebuildAt] !== word) {
      busy = true;
      await convex.mutation(api.matches.rebuildTap, {
        sessionToken,
        code: matchCode,
        word,
      });
      return;
    }
    busy = true;
    rebuildAt += 1;
    paintTiles();
    await dropWordOntoStack(word);
    await convex.mutation(api.matches.rebuildTap, {
      sessionToken,
      code: matchCode,
      word,
    });
    return;
  }
  if (!matchNeedsAdd(matchView)) return;
  if (matchView.stack.includes(word)) return;
  busy = true;
  stack.push(word);
  paintTiles();
  await dropWordOntoStack(word);
  renderedStack = stack.slice();
  await convex.mutation(api.matches.addWord, {
    sessionToken,
    code: matchCode,
    word,
  });
}

function matchSeat(view: MatchView): "host" | "guest" | null {
  if (currentPlayerId && view.hostId === currentPlayerId) return "host";
  if (currentPlayerId && view.guestId === currentPlayerId) return "guest";
  return null;
}

function matchUnlocked(view: MatchView, seat: "host" | "guest"): boolean {
  if (view.status === "over" || view.status === "waiting") return false;
  if (seat === "host") {
    return view.status === "p1_add" || view.status === "p1_turn";
  }
  return view.status === "p2_add" || view.status === "p2_turn";
}

function matchNeedsRebuild(view: MatchView): boolean {
  return (
    (view.status === "p1_turn" || view.status === "p2_turn") &&
    view.rebuildAt < view.stack.length
  );
}

function matchNeedsAdd(view: MatchView): boolean {
  if (view.endurance || view.stack.length >= 15) return false;
  if (view.status === "p1_add" || view.status === "p2_add") return true;
  if (view.status === "p1_turn" || view.status === "p2_turn") {
    return view.rebuildAt === view.stack.length;
  }
  return false;
}

function stopMatchSub(): void {
  if (matchUnsub) {
    matchUnsub();
    matchUnsub = null;
  }
  matchView = null;
  pvpMemorize = false;
  pvpWasUnlocked = false;
  pvpTimeoutSent = false;
  renderedStack = [];
}

function showDailyModal(dayId: string, theme: string): void {
  waitEl.classList.remove("show");
  endEl.classList.remove("show");
  dailyDateEl.textContent = formatDayId(dayId);
  dailyThemeEl.textContent = theme;
  dailyEl.classList.add("show");
}

function showWaitModal(code: string): void {
  dailyEl.classList.remove("show");
  waitCodeEl.textContent = code;
  waitEl.classList.add("show");
}

function showPvpEnd(view: MatchView): void {
  cancelMem();
  setTimerIdle();
  phase = "over";
  waitEl.classList.remove("show");
  dailyEl.classList.remove("show");
  const won = Boolean(currentPlayerId && view.winnerId === currentPlayerId);
  document.getElementById("end-title")!.textContent = won ? "YOU WIN" : "YOU LOSE";
  document.getElementById("end-score")!.textContent = String(view.score);
  againBtn.hidden = true;
  seeBoardBtn.hidden = false;
  tomorrowEl.hidden = true;
  pvpNoteEl.hidden = false;
  endEl.classList.add("show");
}

function pvpClockLeft(view: MatchView, seat: "host" | "guest"): number {
  const stored = seat === "host" ? view.p1LeftMs : view.p2LeftMs;
  const unlocked = matchUnlocked(view, seat);
  if (!unlocked || view.turnStartedAt === null) return stored;
  return Math.max(0, stored - (Date.now() - view.turnStartedAt));
}

async function pvpTimeout(): Promise<void> {
  if (pvpTimeoutSent || !matchCode || !sessionToken) return;
  pvpTimeoutSent = true;
  await convex.mutation(api.matches.timeout, {
    sessionToken,
    code: matchCode,
  });
}

function syncPvpTimer(view: MatchView, seat: "host" | "guest"): void {
  const unlocked = matchUnlocked(view, seat);
  if (!unlocked) {
    cancelMem();
    const stored = seat === "host" ? view.p1LeftMs : view.p2LeftMs;
    if (view.status === "waiting") {
      setTimerIdle();
    } else {
      setTimerRun(stored);
    }
    return;
  }
  const left = pvpClockLeft(view, seat);
  if (left <= 0) {
    void pvpTimeout();
    setTimerIdle();
    return;
  }
  if (!mem.running || mem.paused) {
    startBudgetFrom(left, () => {
      void pvpTimeout();
    });
  } else {
    mem.left = left;
    mem.lastSec = Math.ceil(left / 1000);
    setTimerRun(left);
  }
}

async function applyMatch(view: MatchView | null): Promise<void> {
  if (!view) {
    stopMatchSub();
    matchCode = null;
    return;
  }
  matchView = view;
  words = view.words.slice();
  if (tiles.length !== words.length) {
    makeTiles(words);
  }

  if (view.status === "waiting") {
    showWaitModal(view.code);
    cancelMem();
    setTimerIdle();
    return;
  }

  waitEl.classList.remove("show");
  dailyEl.classList.remove("show");

  if (view.status === "over") {
    showPvpEnd(view);
    return;
  }

  const seat = matchSeat(view);
  stack = view.stack.slice();
  const unlocked = seat ? matchUnlocked(view, seat) : false;
  const becameUnlocked = unlocked && !pvpWasUnlocked;
  pvpWasUnlocked = unlocked;

  const samePrefix =
    view.stack.length === renderedStack.length + 1 &&
    renderedStack.every((w, i) => w === view.stack[i]);
  if (samePrefix && (!unlocked || matchNeedsAdd(view) === false || !becameUnlocked)) {
    const added = view.stack[view.stack.length - 1]!;
    if (!unlocked) {
      phase = "memorize";
      await dropWordOntoStack(added);
    }
  } else if (view.stack.join("\0") !== renderedStack.join("\0")) {
    if (!unlocked) {
      phase = "memorize";
      renderStack();
    }
  }
  renderedStack = view.stack.slice();

  if (seat) {
    syncPvpTimer(view, seat);
  }

  if (!unlocked) {
    pvpMemorize = false;
    phase = "memorize";
    rebuildAt = 0;
    collapseSheet();
    paintTiles();
    renderStack();
    busy = true;
    return;
  }

  if (matchNeedsRebuild(view)) {
    if (becameUnlocked) {
      pvpMemorize = true;
      phase = "memorize";
      busy = true;
      paintTiles();
      resetStackMotion();
      stackEl.classList.add("is-memorize");
      for (const b of tiles) {
        b.classList.remove("on");
      }
      await flipShuffle();
      if (phase !== "memorize" || endEl.classList.contains("show")) return;
      collapseSheet();
      return;
    }
    if (pvpMemorize) {
      phase = "memorize";
      collapseSheet();
      paintTiles();
      busy = true;
      return;
    }
    phase = "stack";
    rebuildAt = view.rebuildAt;
    expandSheet(false);
    renderStack();
    resetStackMotion();
    paintTiles();
    busy = false;
    return;
  }

  if (matchNeedsAdd(view)) {
    pvpMemorize = false;
    phase = "add";
    rebuildAt = 0;
    expandSheet(false);
    renderStack();
    resetStackMotion();
    paintTiles();
    busy = false;
  }
}

function subscribeMatch(code: string): void {
  stopMatchSub();
  matchCode = code;
  pvpTimeoutSent = false;
  pvpWasUnlocked = false;
  pvpMemorize = false;
  renderedStack = [];
  matchUnsub = convex.onUpdate(api.matches.get, { code }, (view) => {
    void applyMatch(view);
  });
}

async function enterMatch(code: string): Promise<void> {
  if (!sessionToken) return;
  matchCode = code;
  setMatchQuery(code);
  const joined = await convex.mutation(api.matches.join, {
    sessionToken,
    code,
  });
  if (!joined.success) {
    matchCode = null;
    showDailyFromToday();
    return;
  }
  subscribeMatch(code);
}

async function showDailyFromToday(): Promise<void> {
  const today = await convex.query(api.game.getToday, {});
  words = today.words.slice();
  makeTiles(words);
  paintTiles();
  resetStackMotion();
  renderStack();
  expandSheet(false);
  showDailyModal(today.dayId, today.theme);
}

async function startPvcFromDaily(): Promise<void> {
  dailyEl.classList.remove("show");
  matchCode = null;
  stopMatchSub();
  if (submittedToday && !isPlaytest) {
    document.getElementById("end-title")!.textContent = "GAME OVER";
    document.getElementById("end-score")!.textContent = String(lastTodayScore);
    endEl.classList.add("show");
    showConsumedEnd();
    return;
  }
  showPlayableEnd();
  startAdd();
}

async function startPvpFromDaily(): Promise<void> {
  if (!sessionToken) return;
  const created = await convex.mutation(api.matches.create, { sessionToken });
  if (!created.success) return;
  matchCode = created.code;
  setMatchQuery(created.code);
  dailyEl.classList.remove("show");
  subscribeMatch(created.code);
}

async function onTap(word: string): Promise<void> {
  if (busy) return;
  if (overlayBlocksPlay()) return;
  ensureAudio();
  if (matchCode) {
    if (matchView && sessionToken) {
      await onMatchTap(word);
    }
    return;
  }
  if (phase === "add") {
    if (stack.includes(word)) return;
    busy = true;
    stack.push(word);
    grantIncrement();
    paintTiles();
    await dropWordOntoStack(word);
    if (phase !== "add") {
      renderStack();
      return;
    }
    const left = unused();
    if (left.length) {
      await sleep(80);
      if (phase !== "add") {
        renderStack();
        return;
      }
      const pick = left[Math.floor(Math.random() * left.length)]!;
      stack.push(pick);
      paintTiles();
      await dropWordOntoStack(pick);
    }
    if (phase !== "add") {
      renderStack();
      return;
    }
    await startMemorize();
    return;
  }
  if (phase === "stack") {
    const expected = stack[rebuildAt];
    if (word !== expected) {
      void gameOver();
      return;
    }
    rebuildAt += 1;
    grantIncrement();
    paintTiles();
    busy = true;
    await dropWordOntoStack(word);
    if (phase !== "stack") {
      renderStack();
      return;
    }
    if (rebuildAt === stack.length) {
      if (stack.length < 15) {
        score = stack.length;
        startAdd();
        return;
      }
      if (!endurance) {
        endurance = true;
        score = 15;
        endurancePass = 0;
      } else {
        score *= 2;
        endurancePass += 1;
      }
      await startEnduranceRound();
      return;
    }
    busy = false;
  }
}

async function gameOver(): Promise<void> {
  if (phase === "over") return;
  cancelMem();
  setTimerIdle();
  phase = "over";
  resetStackMotion();
  expandSheet(false);
  paintTiles();
  renderStack();
  document.getElementById("end-title")!.textContent = "GAME OVER";
  document.getElementById("end-score")!.textContent = String(score);
  endEl.classList.add("show");

  if (!isPlaytest && !matchCode && sessionToken && !submittedToday) {
    submittedToday = true;
    await convex.mutation(api.game.submitRun, {
      sessionToken,
      score,
    });
  }

  if (isPlaytest) {
    showPlayableEnd();
  } else {
    showConsumedEnd();
  }
}

function showConsumedEnd(): void {
  againBtn.hidden = true;
  seeBoardBtn.hidden = false;
  tomorrowEl.hidden = false;
  pvpNoteEl.hidden = true;
}

function showPlayableEnd(): void {
  againBtn.hidden = false;
  seeBoardBtn.hidden = true;
  tomorrowEl.hidden = true;
  pvpNoteEl.hidden = true;
}

function formatBoardDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

async function openScores(e: Event): Promise<void> {
  e.stopPropagation();
  closeMenu(false);
  const open = scoresEl.classList.contains("show");
  if (open) {
    scoresEl.classList.remove("show");
    resumeMem();
    return;
  }
  pauseMem();
  boardRows.innerHTML = "";
  boardEmpty.hidden = true;
  const rows = await convex.query(api.game.leaderboard, {});
  if (!rows.length) {
    boardEmpty.hidden = false;
  } else {
    boardRows.innerHTML = rows
      .map(
        (row) => `<div class="board-row">
        <span>${escapeHtml("@" + row.handle)}</span>
        <span>${escapeHtml(row.theme)}</span>
        <span>${row.score}</span>
        <span>${escapeHtml(formatBoardDate(row.finishedAt))}</span>
      </div>`
      )
      .join("");
  }
  scoresEl.classList.add("show");
}

function closeScores(e: Event): void {
  if (e.target !== scoresEl) return;
  scoresEl.classList.remove("show");
  resumeMem();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function showGateError(msg: string): void {
  gateError.hidden = false;
  gateError.textContent = msg;
}

async function submitAuth(mode: "claim" | "signin"): Promise<void> {
  const handle = gateHandle.value.trim();
  const password = gatePass.value;
  gateError.hidden = true;
  if (!handle || !password) {
    showGateError("Enter a handle and passphrase");
    return;
  }
  const fn = mode === "claim" ? api.auth.claimHandle : api.auth.signIn;
  const result = await convex.action(fn, { handle, password });
  if (!result.success || !result.token) {
    showGateError(result.error ?? "Could not sign in");
    return;
  }
  sessionToken = result.token;
  localStorage.setItem(TOKEN_KEY, result.token);
  gateEl.classList.remove("show");
  await afterAuth();
}

async function afterAuth(): Promise<void> {
  if (!sessionToken) {
    gateEl.classList.add("show");
    return;
  }
  const me = await convex.query(api.players.getMe, { sessionToken });
  if (!me) {
    sessionToken = null;
    localStorage.removeItem(TOKEN_KEY);
    gateEl.classList.add("show");
    return;
  }
  currentHandle = me.handle;
  currentPlayerId = me._id;
  menuHandle.textContent = `@${me.handle}`;
  if (isPlaytest || !me.onboarded) {
    showGuide(0, true);
    return;
  }
  await boot(isPlaytest ? false : me.todaySubmitted, me.todayScore);
}

function showGuide(step: number, blocking = guideBlocking): void {
  guideBlocking = blocking;
  guideStep = Math.max(0, Math.min(GUIDE_STEPS - 1, step));
  guideTrack.style.transform = `translateX(-${guideStep * 100}%)`;
  guideDots.forEach((dot, i) => {
    dot.classList.toggle("on", i === guideStep);
  });
  guideGo.textContent = guideStep === GUIDE_STEPS - 1 ? "Play" : "Next";
  guideEl.classList.add("show");
}

async function finishGuide(): Promise<void> {
  const replay = !guideBlocking;
  if (sessionToken) {
    await convex.mutation(api.players.completeOnboarding, { sessionToken });
  }
  guideEl.classList.remove("show");
  guideBlocking = false;
  if (replay) {
    resumeMem();
    return;
  }
  if (!sessionToken) return;
  const me = await convex.query(api.players.getMe, { sessionToken });
  await boot(isPlaytest ? false : Boolean(me?.todaySubmitted), me?.todayScore);
}

async function boot(alreadySubmitted: boolean, todayScore?: number): Promise<void> {
  cancelMem();
  setTimerIdle();
  endEl.classList.remove("show");
  scoresEl.classList.remove("show");
  guideEl.classList.remove("show");
  waitEl.classList.remove("show");
  closeMenu(false);
  stack = [];
  rebuildAt = 0;
  score = 0;
  endurance = false;
  endurancePass = 0;
  phase = "add";
  submittedToday = isPlaytest ? false : alreadySubmitted;
  lastTodayScore = todayScore ?? 0;
  pvpWasUnlocked = false;
  pvpMemorize = false;
  renderedStack = [];

  const pendingCode = matchCodeFromLocation();
  if (pendingCode) {
    dailyEl.classList.remove("show");
    await enterMatch(pendingCode);
    return;
  }

  stopMatchSub();
  matchCode = null;
  const today = await convex.query(api.game.getToday, {});
  words = today.words.slice();
  makeTiles(words);
  paintTiles();
  resetStackMotion();
  renderStack();
  expandSheet(false);
  showPlayableEnd();
  showDailyModal(today.dayId, today.theme);
}

let sheetDragY: number | null = null;
let sheetPointerId: number | null = null;
let sheetTriggered = false;

function moveSheet(clientY: number): void {
  if (sheetDragY == null || phase !== "memorize" || sheetTriggered) return;
  const max = collapsedOffset();
  const lifted = Math.max(0, Math.min(max, sheetDragY - clientY));
  gridSheetEl.style.transform = `translateY(${max - lifted}px)`;
  applyStackDismiss(Math.min(0.85, lifted / SHEET_PULL_THRESHOLD), false);
  if (lifted >= SHEET_PULL_THRESHOLD) {
    sheetTriggered = true;
    sheetDragY = null;
    void finishMemorize();
  }
}

gridSheetEl.addEventListener("pointerdown", (e) => {
  if (overlayBlocksPlay()) return;
  if (phase !== "memorize") return;
  e.preventDefault();
  gridSheetEl.setPointerCapture(e.pointerId);
  gridSheetEl.classList.add("dragging");
  gridSheetEl.classList.remove("collapsed");
  sheetDragY = e.clientY;
  sheetPointerId = e.pointerId;
  sheetTriggered = false;
  gridSheetEl.style.transition = "none";
  gridSheetEl.style.transform = `translateY(${collapsedOffset()}px)`;
  applyStackDismiss(0, false);
});
gridSheetEl.addEventListener("pointermove", (e) => {
  if (sheetPointerId !== e.pointerId) return;
  moveSheet(e.clientY);
});
function endSheetDrag(e: PointerEvent): void {
  if (sheetPointerId !== e.pointerId) return;
  moveSheet(e.clientY);
  sheetDragY = null;
  sheetPointerId = null;
  gridSheetEl.classList.remove("dragging");
  if (!sheetTriggered && phase === "memorize") {
    gridSheetEl.style.transition = "transform 220ms ease";
    gridSheetEl.style.transform = `translateY(${collapsedOffset()}px)`;
    applyStackDismiss(0, true);
    window.setTimeout(() => {
      if (phase === "memorize") {
        gridSheetEl.classList.add("collapsed", "pullable");
        gridSheetEl.style.transition = "";
        gridSheetEl.style.transform = "";
        resetStackMotion();
        stackEl.classList.add("is-memorize");
      }
    }, 220);
  }
  sheetTriggered = false;
}
window.addEventListener("pointerup", endSheetDrag);
window.addEventListener("pointercancel", endSheetDrag);

function openMenu(): void {
  if (!sessionToken || menuButton.getAttribute("aria-expanded") === "true") {
    return;
  }
  menuHandle.textContent = currentHandle ? `@${currentHandle}` : "@player";
  menuBackdrop.hidden = false;
  menuPopover.hidden = false;
  menuButton.setAttribute("aria-expanded", "true");
  menuButton.setAttribute("aria-label", "Close menu");
}

function closeMenu(_shouldResume = true): void {
  if (menuButton.getAttribute("aria-expanded") !== "true") return;
  menuBackdrop.hidden = true;
  menuPopover.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Open menu");
}

async function signOut(): Promise<void> {
  const token = sessionToken;
  closeMenu(false);
  cancelMem();
  setTimerIdle();
  sessionToken = null;
  currentHandle = "";
  currentPlayerId = "";
  stopMatchSub();
  matchCode = null;
  dailyEl.classList.remove("show");
  waitEl.classList.remove("show");
  localStorage.removeItem(TOKEN_KEY);
  endEl.classList.remove("show");
  scoresEl.classList.remove("show");
  guideEl.classList.remove("show");
  guideBlocking = false;
  gateEl.classList.add("show");
  gatePass.value = "";
  if (token) {
    await convex.mutation(api.players.signOut, { sessionToken: token });
  }
}

menuButton.addEventListener("click", () => {
  if (menuButton.getAttribute("aria-expanded") === "true") {
    closeMenu();
  } else {
    openMenu();
  }
});
menuBackdrop.addEventListener("click", () => {
  closeMenu();
});
menuLeaderboard.addEventListener("click", (e) => {
  void openScores(e);
});
menuHowto.addEventListener("click", () => {
  closeMenu(false);
  scoresEl.classList.remove("show");
  pauseMem();
  showGuide(0, false);
});
menuFeedback.addEventListener("click", () => {
  closeMenu();
});
menuSignout.addEventListener("click", () => {
  void signOut();
});
scoresEl.addEventListener("click", closeScores);
dailyPvcBtn.addEventListener("click", () => {
  void startPvcFromDaily();
});
dailyPvpBtn.addEventListener("click", () => {
  void startPvpFromDaily();
});
waitCopyBtn.addEventListener("click", async () => {
  if (!matchCode) return;
  const link = matchShareUrl(matchCode);
  try {
    await navigator.clipboard.writeText(link);
    waitCopyBtn.textContent = "Copied";
    window.setTimeout(() => {
      waitCopyBtn.textContent = "Copy link";
    }, 1200);
  } catch {
    waitCopyBtn.textContent = "Copy failed";
  }
});
againBtn.addEventListener("click", () => {
  if (submittedToday && !isPlaytest) return;
  void boot(false);
});
seeBoardBtn.addEventListener("click", (e) => {
  void openScores(e);
});
gateForm.addEventListener("submit", (e) => {
  e.preventDefault();
  void submitAuth("claim");
});
gateIn.addEventListener("click", () => {
  void submitAuth("signin");
});
guideGo.addEventListener("click", () => {
  if (guideStep >= GUIDE_STEPS - 1) {
    void finishGuide();
    return;
  }
  showGuide(guideStep + 1);
});
guideDots.forEach((dot, i) => {
  dot.addEventListener("click", () => {
    showGuide(i);
  });
});
let guideSwipeX: number | null = null;
guideViewport.addEventListener("pointerdown", (e) => {
  guideSwipeX = e.clientX;
});
window.addEventListener("pointerup", (e) => {
  if (guideSwipeX == null || !guideEl.classList.contains("show")) {
    guideSwipeX = null;
    return;
  }
  const dx = e.clientX - guideSwipeX;
  guideSwipeX = null;
  if (dx <= -48) showGuide(guideStep + 1);
  if (dx >= 48) showGuide(guideStep - 1);
});
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (menuButton.getAttribute("aria-expanded") === "true") {
    closeMenu();
  } else if (guideEl.classList.contains("show") && !guideBlocking) {
    guideEl.classList.remove("show");
    resumeMem();
  } else if (scoresEl.classList.contains("show")) {
    scoresEl.classList.remove("show");
    resumeMem();
  }
});

if (sessionToken) {
  void afterAuth();
} else {
  gateEl.classList.add("show");
}
