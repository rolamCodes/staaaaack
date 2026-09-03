import "./style.css";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const TOKEN_KEY = "staaaaack-session";
const CIRC = 2 * Math.PI * 15.5;
const START_BUDGET_MS = 60_000;
const INCREMENT_MS = 3_000;

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is missing. Copy .env.example to .env.local.");
}
const convex = new ConvexClient(convexUrl);

const gridEl = document.getElementById("grid")!;
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
const gridSheetEl = document.getElementById("grid-sheet")!;
const againBtn = document.getElementById("again") as HTMLButtonElement;
const seeBoardBtn = document.getElementById("see-board") as HTMLButtonElement;
const tomorrowEl = document.getElementById("tomorrow")!;
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
const GUIDE_STEPS = 4;
let guideStep = 0;

let sessionToken = localStorage.getItem(TOKEN_KEY);
let currentHandle = "";
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
let audio: AudioContext | undefined;
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
  dur: number,
  type: OscillatorType = "sine"
): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
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

function beepComputer(): void {
  try {
    const ctx = ensureAudio();
    const t = ctx.currentTime;
    tone(ctx, 349, t, 0.075, 0.16, "triangle");
    tone(ctx, 262, t + 0.11, 0.08, 0.22, "triangle");
  } catch {
    /* ignore autoplay / closed context */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

function renderStack(): void {
  stackWordsEl.innerHTML = "";
  const shown =
    phase === "stack"
      ? stack.slice(0, rebuildAt).slice().reverse()
      : phase === "over"
        ? []
        : stack.slice().reverse();
  for (const w of shown) {
    const d = document.createElement("div");
    d.className = "word";
    d.textContent = w;
    stackWordsEl.appendChild(d);
  }
  stackWordsEl.scrollTop = 0;
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
  stackEl.classList.remove("memorize");
  gridSheetEl.classList.remove("pullable", "dragging");
  resetSheetPosition();
  paintTiles();
  renderStack();
  busy = false;
  startBudget();
}

function startMemorize(): void {
  phase = "memorize";
  busy = true;
  stackEl.classList.add("memorize");
  gridSheetEl.classList.add("pullable");
  paintTiles();
  renderStack();
}

async function finishMemorize(): Promise<void> {
  if (phase !== "memorize") return;
  phase = "stack";
  gridSheetEl.classList.remove("pullable", "dragging");
  gridSheetEl.style.transition = "transform 380ms cubic-bezier(.2,.7,.2,1)";
  gridSheetEl.style.transform = "translateY(-96px)";
  stackEl.classList.add("hiding");
  await sleep(380);
  stackEl.classList.remove("hiding", "memorize");
  resetSheetPosition();
  if (endEl.classList.contains("show")) return;
  await startRebuild();
}

async function startRebuild(): Promise<void> {
  phase = "stack";
  rebuildAt = 0;
  busy = true;
  stackEl.classList.remove("memorize");
  gridSheetEl.classList.remove("pullable", "dragging");
  resetSheetPosition();
  renderStack();
  paintTiles();
  await flipShuffle();
  if (endEl.classList.contains("show")) return;
  paintTiles();
  busy = false;
}

async function startEnduranceRound(): Promise<void> {
  phase = "stack";
  rebuildAt = 0;
  busy = true;
  renderStack();
  paintTiles();
  await flipShuffle();
  if (endEl.classList.contains("show")) return;
  paintTiles();
  busy = false;
}

async function onTap(word: string): Promise<void> {
  if (busy) return;
  if (scoresEl.classList.contains("show")) return;
  if (endEl.classList.contains("show")) return;
  if (gateEl.classList.contains("show")) return;
  if (guideEl.classList.contains("show")) return;
  ensureAudio();
  if (phase === "add") {
    if (stack.includes(word)) return;
    busy = true;
    stack.push(word);
    grantIncrement();
    paintTiles();
    renderStack();
    const left = unused();
    if (left.length) {
      await sleep(350);
      if (phase !== "add") return;
      const pick = left[Math.floor(Math.random() * left.length)]!;
      stack.push(pick);
      paintTiles();
      renderStack();
      beepComputer();
    }
    if (phase !== "add") return;
    startMemorize();
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
    renderStack();
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
    }
  }
}

async function gameOver(): Promise<void> {
  if (phase === "over") return;
  cancelMem();
  setTimerIdle();
  phase = "over";
  stackEl.classList.remove("memorize");
  gridSheetEl.classList.remove("pullable", "dragging");
  resetSheetPosition();
  paintTiles();
  renderStack();
  document.getElementById("end-title")!.textContent = "GAME OVER";
  document.getElementById("end-score")!.textContent = String(score);
  endEl.classList.add("show");

  if (sessionToken && !submittedToday) {
    submittedToday = true;
    await convex.mutation(api.game.submitRun, {
      sessionToken,
      score,
    });
  }

  showConsumedEnd();
}

function showConsumedEnd(): void {
  againBtn.hidden = true;
  seeBoardBtn.hidden = false;
  tomorrowEl.hidden = false;
}

function showPlayableEnd(): void {
  againBtn.hidden = false;
  seeBoardBtn.hidden = true;
  tomorrowEl.hidden = true;
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
        <div class="board-handle">${escapeHtml(row.handle)}</div>
        <div class="board-score">${row.score}</div>
        <div class="board-theme">${escapeHtml(row.theme)}</div>
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
  menuHandle.textContent = `@${me.handle}`;
  if (!me.onboarded) {
    await loadToday();
    showGuide(0);
    return;
  }
  await boot(me.todaySubmitted, me.todayScore);
}

function showGuide(step: number): void {
  guideStep = Math.max(0, Math.min(GUIDE_STEPS - 1, step));
  guideTrack.style.transform = `translateX(-${guideStep * 100}%)`;
  guideDots.forEach((dot, i) => {
    dot.classList.toggle("on", i === guideStep);
  });
  guideGo.textContent = guideStep === GUIDE_STEPS - 1 ? "Play" : "Next";
  guideEl.classList.add("show");
}

async function finishGuide(): Promise<void> {
  if (!sessionToken) return;
  await convex.mutation(api.players.completeOnboarding, { sessionToken });
  guideEl.classList.remove("show");
  await boot(false);
}

async function loadToday(): Promise<void> {
  cancelMem();
  setTimerIdle();
  stack = [];
  rebuildAt = 0;
  score = 0;
  endurance = false;
  endurancePass = 0;
  phase = "add";
  const today = await convex.query(api.game.getToday, {});
  words = today.words.slice();
  makeTiles(words);
  paintTiles();
  renderStack();
}

async function boot(alreadySubmitted: boolean, todayScore?: number): Promise<void> {
  endEl.classList.remove("show");
  scoresEl.classList.remove("show");
  closeMenu(false);
  submittedToday = alreadySubmitted;
  await loadToday();

  if (alreadySubmitted) {
    document.getElementById("end-title")!.textContent = "GAME OVER";
    document.getElementById("end-score")!.textContent = String(todayScore ?? 0);
    endEl.classList.add("show");
    showConsumedEnd();
    return;
  }

  showPlayableEnd();
  startAdd();
}

let sheetDragY: number | null = null;
let sheetPointerId: number | null = null;
let sheetTriggered = false;

function resetSheetPosition(): void {
  gridSheetEl.style.transition = "";
  gridSheetEl.style.transform = "";
}

function moveSheet(clientY: number): void {
  if (sheetDragY == null || phase !== "memorize" || sheetTriggered) return;
  const distance = Math.max(0, Math.min(112, sheetDragY - clientY));
  gridSheetEl.style.transform = `translateY(-${distance}px)`;
  stackWordsEl.style.opacity = String(Math.max(0.12, 1 - distance / 104));
  if (distance >= 72) {
    sheetTriggered = true;
    sheetDragY = null;
    stackWordsEl.style.opacity = "";
    void finishMemorize();
  }
}

gridSheetEl.addEventListener("pointerdown", (e) => {
  if (phase !== "memorize") return;
  e.preventDefault();
  gridSheetEl.setPointerCapture(e.pointerId);
  gridSheetEl.classList.add("dragging");
  sheetDragY = e.clientY;
  sheetPointerId = e.pointerId;
  sheetTriggered = false;
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
  if (!sheetTriggered) {
    gridSheetEl.style.transition = "transform 220ms ease";
    gridSheetEl.style.transform = "";
    window.setTimeout(() => {
      if (phase === "memorize") gridSheetEl.style.transition = "";
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
  pauseMem();
  menuHandle.textContent = currentHandle ? `@${currentHandle}` : "@player";
  menuBackdrop.hidden = false;
  menuPopover.hidden = false;
  menuButton.setAttribute("aria-expanded", "true");
  menuButton.setAttribute("aria-label", "Close menu");
}

function closeMenu(shouldResume = true): void {
  if (menuButton.getAttribute("aria-expanded") !== "true") return;
  menuBackdrop.hidden = true;
  menuPopover.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Open menu");
  if (shouldResume) resumeMem();
}

async function signOut(): Promise<void> {
  const token = sessionToken;
  closeMenu(false);
  cancelMem();
  setTimerIdle();
  sessionToken = null;
  currentHandle = "";
  localStorage.removeItem(TOKEN_KEY);
  endEl.classList.remove("show");
  scoresEl.classList.remove("show");
  guideEl.classList.remove("show");
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
menuFeedback.addEventListener("click", () => {
  closeMenu();
});
menuSignout.addEventListener("click", () => {
  void signOut();
});
scoresEl.addEventListener("click", closeScores);
againBtn.addEventListener("click", () => {
  if (submittedToday) return;
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

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (menuButton.getAttribute("aria-expanded") === "true") {
      closeMenu();
    } else if (scoresEl.classList.contains("show")) {
      scoresEl.classList.remove("show");
      resumeMem();
    }
  }
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

if (sessionToken) {
  void afterAuth();
} else {
  gateEl.classList.add("show");
}
