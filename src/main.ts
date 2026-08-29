import "./style.css";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const TOKEN_KEY = "staaaaack-session";
const CIRC = 2 * Math.PI * 15.5;

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is missing. Copy .env.example to .env.local.");
}
const convex = new ConvexClient(convexUrl);

const gridEl = document.getElementById("grid")!;
const stackEl = document.getElementById("stack")!;
const timerEl = document.getElementById("timer")!;
const timerNum = timerEl.querySelector(".num")!;
const ringSolid = timerEl.querySelector(".ring-solid") as SVGCircleElement;
const endEl = document.getElementById("end")!;
const scoresEl = document.getElementById("scores")!;
const trophyBtn = document.getElementById("trophy")!;
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

let sessionToken = localStorage.getItem(TOKEN_KEY);
let words: string[] = [];
let tiles: HTMLButtonElement[] = [];
let stack: string[] = [];
let phase: "add" | "stack" | "over" = "add";
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

function nextRebuildLen(): number {
  const remain = words.length - stack.length;
  const add = remain >= 2 ? 2 : remain;
  return stack.length + add;
}

function climbTimerMs(rebuildLen: number): number {
  if (rebuildLen <= 5) return 12_000;
  if (rebuildLen <= 10) return 18_000;
  return 24_000;
}

function enduranceTimerMs(pass: number): number {
  if (pass === 0) return 24_000;
  if (pass === 1) return 18_000;
  if (pass === 2) return 13_000;
  if (pass === 3) return 10_000;
  return 8_000;
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

function beep(high: boolean): void {
  try {
    const ctx = ensureAudio();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = high ? 880 : 520;
    g.gain.value = 0.07;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
    o.stop(ctx.currentTime + 0.11);
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
  for (const b of tiles) {
    const word = b.dataset.word ?? "";
    b.classList.remove("on", "is-off");
    b.disabled = false;
    if (phase === "add") {
      if (inStack.has(word)) {
        b.classList.add("on", "is-off");
        b.disabled = true;
      }
    } else if (phase === "over") {
      b.disabled = true;
      b.classList.add("is-off");
    }
  }
}

function renderStack(): void {
  stackEl.innerHTML = "";
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
    stackEl.appendChild(d);
  }
  stackEl.scrollTop = 0;
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

function setTimerRun(left: number, duration: number): void {
  timerEl.className = "run";
  timerNum.textContent = String(Math.max(1, Math.ceil(left / 1000)));
  const p = Math.max(0, Math.min(1, left / duration));
  ringSolid.style.strokeDashoffset = String(CIRC * (1 - p));
  timerEl.removeAttribute("aria-hidden");
}

function cancelMem(): void {
  mem.running = false;
  mem.paused = false;
  if (mem.raf) cancelAnimationFrame(mem.raf);
  mem.raf = 0;
}

function startCountdown(duration: number, onDone: () => void): void {
  mem.onDone = onDone;
  mem.duration = duration;
  mem.left = duration;
  mem.running = true;
  mem.paused = false;
  mem.started = performance.now();
  mem.lastSec = Math.ceil(mem.left / 1000);
  setTimerRun(mem.left, mem.duration);
  beep(false);
  loopMem();
}

function loopMem(): void {
  if (!mem.running) return;
  const step = (now: number) => {
    if (!mem.running) return;
    if (mem.paused) {
      mem.raf = requestAnimationFrame(step);
      return;
    }
    const elapsed = now - mem.started;
    mem.left = Math.max(0, mem.duration - elapsed);
    setTimerRun(mem.left, mem.duration);
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
  mem.left = Math.max(0, mem.duration - (performance.now() - mem.started));
}

function resumeMem(): void {
  if (!mem.running || !mem.paused) return;
  mem.paused = false;
  mem.started = performance.now() - (mem.duration - mem.left);
  mem.lastSec = Math.ceil(mem.left / 1000);
}

function startAdd(): void {
  phase = "add";
  rebuildAt = 0;
  paintTiles();
  renderStack();
  busy = false;
  startCountdown(climbTimerMs(nextRebuildLen()), () => {
    void gameOver();
  });
}

async function startRebuild(): Promise<void> {
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

async function startEnduranceRound(): Promise<void> {
  phase = "stack";
  rebuildAt = 0;
  busy = true;
  startCountdown(enduranceTimerMs(endurancePass), () => {
    void gameOver();
  });
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
    }
    if (phase !== "add") return;
    await startRebuild();
    return;
  }
  if (phase === "stack") {
    const expected = stack[rebuildAt];
    if (word !== expected) {
      void gameOver();
      return;
    }
    rebuildAt += 1;
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
      mem.onDone = null;
      cancelMem();
      await startEnduranceRound();
    }
  }
}

async function gameOver(): Promise<void> {
  if (phase === "over") return;
  cancelMem();
  setTimerIdle();
  phase = "over";
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
  if (!me.onboarded) {
    guideEl.classList.add("show");
    return;
  }
  await boot(me.todaySubmitted, me.todayScore);
}

async function finishGuide(): Promise<void> {
  if (!sessionToken) return;
  await convex.mutation(api.players.completeOnboarding, { sessionToken });
  guideEl.classList.remove("show");
  await boot(false);
}

async function boot(alreadySubmitted: boolean, todayScore?: number): Promise<void> {
  cancelMem();
  setTimerIdle();
  endEl.classList.remove("show");
  scoresEl.classList.remove("show");
  stack = [];
  rebuildAt = 0;
  score = 0;
  endurance = false;
  endurancePass = 0;
  phase = "add";
  submittedToday = alreadySubmitted;

  const today = await convex.query(api.game.getToday, {});
  words = today.words.slice();
  makeTiles(words);
  paintTiles();
  renderStack();

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

trophyBtn.addEventListener("click", (e) => {
  void openScores(e);
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
  void finishGuide();
});

if (sessionToken) {
  void afterAuth();
} else {
  gateEl.classList.add("show");
}
