import "./style.css";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const TOKEN_KEY = "staaaaack-session";
const PLAYTEST_TUTORIAL_KEY = "staaaaack-playtest-tutorial";
const CIRC = 2 * Math.PI * 15.5;
const START_BUDGET_MS = 60_000;
const INCREMENT_MS = 3_000;
const SHEET_PEEK = 44;
const SHEET_PULL_THRESHOLD = 72;
const WORD_DROP_MS = 340;
const TUTORIAL_WORDS = ["Mayo", "Tomato", "Cheese", "Lettuce", "Bacon"];
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
const menuTutorial = document.getElementById(
  "menu-tutorial"
) as HTMLButtonElement;
const menuTutorialState = document.getElementById("menu-tutorial-state")!;
const againBtn = document.getElementById("again") as HTMLButtonElement;
const seeBoardBtn = document.getElementById("see-board") as HTMLButtonElement;
const tomorrowEl = document.getElementById("tomorrow")!;
const playtestNoteEl = document.getElementById("playtest-note")!;
const boardRows = document.getElementById("board-rows")!;
const boardEmpty = document.getElementById("board-empty")!;
const gateEl = document.getElementById("gate")!;
const gateForm = document.getElementById("gate-form") as HTMLFormElement;
const gateHandle = document.getElementById("gate-handle") as HTMLInputElement;
const gatePass = document.getElementById("gate-pass") as HTMLInputElement;
const gateError = document.getElementById("gate-error")!;
const gateSubmit = document.getElementById("gate-submit") as HTMLButtonElement;
const gateModeBtn = document.getElementById("gate-mode") as HTMLButtonElement;
const gateSwitchLead = document.getElementById("gate-switch-lead")!;
const guideEl = document.getElementById("guide")!;
const guideGo = document.getElementById("guide-go")!;
const guideTrack = document.getElementById("guide-track")!;
const guideViewport = document.getElementById("guide-viewport")!;
const guideDots = [...document.querySelectorAll("#guide-dots button")];
const menuHowto = document.getElementById("menu-howto") as HTMLButtonElement;
const coachEl = document.getElementById("coach")!;
const coachTip = document.getElementById("coach-tip")!;
const GUIDE_STEPS = 6;
let guideStep = 0;
let guideBlocking = false;
let gateMode: "signin" | "signup" = "signin";

type CoachStep =
  | "tap-add"
  | "computer-add"
  | "timer-tip"
  | "memorize"
  | "pull"
  | "rebuild"
  | null;

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
let targetWords = 15;
let tutorialActive = false;
let tutorialCleared = false;
let needsTutorial = false;
let coachStep: CoachStep = null;
let timerTipShown = false;
let playtestTutorialOn =
  isPlaytest && localStorage.getItem(PLAYTEST_TUTORIAL_KEY) === "1";

if (isPlaytest) {
  document.title = "staaaaack · playtest";
  playtestNoteEl.hidden = false;
  menuTutorial.hidden = false;
  syncPlaytestTutorialMenu();
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

function syncPlaytestTutorialMenu(): void {
  menuTutorial.setAttribute(
    "aria-pressed",
    playtestTutorialOn ? "true" : "false"
  );
  menuTutorialState.textContent = playtestTutorialOn ? "On" : "Off";
}

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

function clearCoachHighlights(): void {
  for (const el of document.querySelectorAll(".coach-hi, .coach-lift")) {
    el.classList.remove("coach-hi", "coach-lift");
  }
}

function hideCoach(): void {
  coachStep = null;
  coachEl.classList.remove("show");
  coachEl.hidden = true;
  coachTip.textContent = "";
  coachTip.className = "";
  clearCoachHighlights();
  document.getElementById("app")!.classList.remove("coach-timer");
}

function showCoach(
  step: CoachStep,
  text: string,
  targets: Element[],
  tipPos: "high" | "mid" | "low" = "low"
): void {
  if (!tutorialActive || !step) {
    hideCoach();
    return;
  }
  coachStep = step;
  clearCoachHighlights();
  document.getElementById("app")!.classList.remove("coach-timer");
  let liftsSheet = false;
  for (const el of targets) {
    el.classList.add("coach-hi");
    if (el === timerEl) {
      document.getElementById("app")!.classList.add("coach-timer");
    }
    if (tiles.includes(el as HTMLButtonElement)) liftsSheet = true;
  }
  if (liftsSheet) gridSheetEl.classList.add("coach-lift");
  coachTip.textContent = text;
  coachTip.className =
    tipPos === "high"
      ? "coach-tip-high"
      : tipPos === "mid"
        ? "coach-tip-mid"
        : "";
  coachEl.hidden = false;
  coachEl.classList.add("show");
}

function shakeCoachTip(): void {
  coachTip.classList.remove("shake");
  void coachTip.offsetWidth;
  coachTip.classList.add("shake");
}

function coachUnusedTiles(): HTMLButtonElement[] {
  const used = new Set(stack);
  return tiles.filter((b) => !used.has(b.dataset.word ?? ""));
}

function coachExpectedTile(): HTMLButtonElement | null {
  const expected = stack[rebuildAt];
  if (!expected) return null;
  return tiles.find((b) => b.dataset.word === expected) ?? null;
}

function updateCoachForPhase(): void {
  if (!tutorialActive || phase === "over") {
    hideCoach();
    return;
  }
  if (phase === "add") {
    const unusedTiles = coachUnusedTiles();
    const firstCycle = stack.length === 0;
    showCoach(
      "tap-add",
      firstCycle
        ? "Tap a word to add it to the stack"
        : "Add another word to grow the stack",
      unusedTiles,
      "mid"
    );
    return;
  }
  if (phase === "memorize") {
    if (coachStep === "pull") {
      showCoach(
        "pull",
        "Pull the sheet up when you’re ready to rebuild",
        [gridSheetEl],
        "mid"
      );
      return;
    }
    showCoach(
      "memorize",
      "Memorize the stack — oldest at the bottom, newest on top",
      [stackEl],
      "high"
    );
    window.setTimeout(() => {
      if (!tutorialActive || phase !== "memorize") return;
      showCoach(
        "pull",
        "Pull the sheet up when you’re ready to rebuild",
        [gridSheetEl],
        "mid"
      );
    }, 2200);
    return;
  }
  if (phase === "stack") {
    const expected = coachExpectedTile();
    showCoach(
      "rebuild",
      "Rebuild oldest-first. Tap the next word in order.",
      expected ? [expected] : [],
      "mid"
    );
  }
}

async function showComputerAddCoach(): Promise<void> {
  if (!tutorialActive) return;
  showCoach(
    "computer-add",
    "The computer adds a word too. Watch the stack grow.",
    [stackEl],
    "high"
  );
  await sleep(1400);
}

async function maybeShowTimerTip(): Promise<void> {
  if (!tutorialActive || timerTipShown) return;
  timerTipShown = true;
  showCoach(
    "timer-tip",
    "Each correct word adds 3 seconds to the clock",
    [timerEl],
    "high"
  );
  await sleep(1800);
}

function makeTiles(list: string[]): void {
  gridEl.innerHTML = "";
  gridEl.classList.toggle("tutorial-grid", list.length === 5);
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

function startBudget(paused = false): void {
  if (mem.running) return;
  mem.onDone = () => {
    void gameOver();
  };
  mem.duration = START_BUDGET_MS;
  mem.left = START_BUDGET_MS;
  mem.running = true;
  mem.paused = paused;
  mem.started = performance.now();
  mem.lastSec = Math.ceil(mem.left / 1000);
  setTimerRun(mem.left);
  if (!paused) beep(false);
  loopMem();
}

function grantIncrement(): void {
  if (!mem.running || phase === "over") return;
  if (tutorialActive) {
    beepIncrement();
    return;
  }
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
  if (tutorialActive) return;
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
  if (!mem.running) startBudget(tutorialActive);
  updateCoachForPhase();
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
  updateCoachForPhase();
}

async function finishMemorize(): Promise<void> {
  if (phase !== "memorize") return;
  phase = "stack";
  hideCoach();
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
  updateCoachForPhase();
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
    await dropWordOntoStack(word);
    if (phase !== "add") {
      renderStack();
      return;
    }
    const left = unused();
    if (left.length) {
      await showComputerAddCoach();
      await sleep(80);
      if (phase !== "add") {
        renderStack();
        return;
      }
      const pick = left[Math.floor(Math.random() * left.length)]!;
      stack.push(pick);
      paintTiles();
      await dropWordOntoStack(pick);
      await maybeShowTimerTip();
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
      if (tutorialActive) {
        shakeCoachTip();
        return;
      }
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
      if (stack.length < targetWords) {
        score = stack.length;
        startAdd();
        return;
      }
      if (tutorialActive) {
        score = targetWords;
        void tutorialSuccess();
        return;
      }
      if (!endurance) {
        endurance = true;
        score = targetWords;
        endurancePass = 0;
      } else {
        score *= 2;
        endurancePass += 1;
      }
      await startEnduranceRound();
      return;
    }
    busy = false;
    updateCoachForPhase();
  }
}

async function tutorialSuccess(): Promise<void> {
  if (phase === "over") return;
  cancelMem();
  setTimerIdle();
  phase = "over";
  tutorialCleared = true;
  hideCoach();
  resetStackMotion();
  expandSheet(false);
  paintTiles();
  renderStack();
  document.getElementById("end-title")!.textContent = "TUTORIAL CLEAR";
  document.getElementById("end-score")!.textContent = String(score);
  endEl.classList.add("show");
  againBtn.hidden = false;
  againBtn.textContent = "Play";
  seeBoardBtn.hidden = true;
  tomorrowEl.hidden = true;
  playtestNoteEl.hidden = true;
}

async function gameOver(): Promise<void> {
  if (phase === "over") return;
  cancelMem();
  setTimerIdle();
  phase = "over";
  hideCoach();
  resetStackMotion();
  expandSheet(false);
  paintTiles();
  renderStack();
  document.getElementById("end-title")!.textContent = "GAME OVER";
  document.getElementById("end-score")!.textContent = String(score);
  endEl.classList.add("show");
  againBtn.textContent = tutorialActive ? "Try again" : "Play again";

  if (tutorialActive) {
    showPlayableEnd();
    playtestNoteEl.hidden = true;
    return;
  }

  if (!isPlaytest && sessionToken && !submittedToday) {
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
}

function showPlayableEnd(): void {
  againBtn.hidden = false;
  seeBoardBtn.hidden = true;
  tomorrowEl.hidden = true;
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

function setGateMode(mode: "signin" | "signup"): void {
  gateMode = mode;
  gateError.hidden = true;
  gateSubmit.textContent = mode === "signin" ? "Sign in" : "Sign up";
  gatePass.setAttribute(
    "autocomplete",
    mode === "signin" ? "current-password" : "new-password"
  );
  gateSwitchLead.textContent =
    mode === "signin" ? "Don't have an account?" : "Already have an account?";
  gateModeBtn.textContent = mode === "signin" ? "Sign up" : "Sign in";
}

async function submitAuth(mode: "claim" | "signin"): Promise<void> {
  const handle = gateHandle.value.trim();
  const password = gatePass.value;
  gateError.hidden = true;
  if (!handle || !password) {
    showGateError("Enter a handle and password");
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

function shouldForceTutorial(onboarded: boolean): boolean {
  if (!onboarded) return true;
  return isPlaytest && playtestTutorialOn;
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
  needsTutorial = shouldForceTutorial(me.onboarded);
  if (needsTutorial) {
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
  guideEl.classList.remove("show");
  guideBlocking = false;
  if (replay) {
    resumeMem();
    return;
  }
  if (!sessionToken) return;
  if (needsTutorial) {
    await startTutorial();
    return;
  }
  const me = await convex.query(api.players.getMe, { sessionToken });
  await boot(isPlaytest ? false : Boolean(me?.todaySubmitted), me?.todayScore);
}

async function startTutorial(): Promise<void> {
  tutorialActive = true;
  tutorialCleared = false;
  timerTipShown = false;
  targetWords = 5;
  hideCoach();
  cancelMem();
  setTimerIdle();
  endEl.classList.remove("show");
  scoresEl.classList.remove("show");
  guideEl.classList.remove("show");
  closeMenu(false);
  stack = [];
  rebuildAt = 0;
  score = 0;
  endurance = false;
  endurancePass = 0;
  phase = "add";
  submittedToday = false;
  againBtn.textContent = "Play again";
  words = TUTORIAL_WORDS.slice();
  makeTiles(words);
  paintTiles();
  resetStackMotion();
  renderStack();
  expandSheet(false);
  showPlayableEnd();
  if (isPlaytest) playtestNoteEl.hidden = true;
  startAdd();
}

async function finishTutorialAndPlay(): Promise<void> {
  if (sessionToken) {
    await convex.mutation(api.players.completeOnboarding, { sessionToken });
  }
  needsTutorial = false;
  tutorialActive = false;
  tutorialCleared = false;
  targetWords = 15;
  hideCoach();
  againBtn.textContent = "Play again";
  if (isPlaytest) playtestNoteEl.hidden = false;
  await boot(false);
}

async function boot(alreadySubmitted: boolean, todayScore?: number): Promise<void> {
  tutorialActive = false;
  tutorialCleared = false;
  targetWords = 15;
  hideCoach();
  cancelMem();
  setTimerIdle();
  endEl.classList.remove("show");
  scoresEl.classList.remove("show");
  guideEl.classList.remove("show");
  closeMenu(false);
  stack = [];
  rebuildAt = 0;
  score = 0;
  endurance = false;
  endurancePass = 0;
  phase = "add";
  submittedToday = isPlaytest ? false : alreadySubmitted;
  againBtn.textContent = "Play again";
  if (isPlaytest) playtestNoteEl.hidden = false;

  const today = await convex.query(api.game.getToday, {});
  words = today.words.slice();
  makeTiles(words);
  paintTiles();
  resetStackMotion();
  renderStack();
  expandSheet(false);

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
  if (guideEl.classList.contains("show")) return;
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
  hideCoach();
  sessionToken = null;
  currentHandle = "";
  tutorialActive = false;
  tutorialCleared = false;
  needsTutorial = false;
  targetWords = 15;
  localStorage.removeItem(TOKEN_KEY);
  endEl.classList.remove("show");
  scoresEl.classList.remove("show");
  guideEl.classList.remove("show");
  guideBlocking = false;
  againBtn.textContent = "Play again";
  gateEl.classList.add("show");
  gatePass.value = "";
  setGateMode("signin");
  if (token) {
    await convex.mutation(api.players.signOut, { sessionToken: token });
  }
}

async function togglePlaytestTutorial(): Promise<void> {
  playtestTutorialOn = !playtestTutorialOn;
  localStorage.setItem(PLAYTEST_TUTORIAL_KEY, playtestTutorialOn ? "1" : "0");
  syncPlaytestTutorialMenu();
  closeMenu(false);
  scoresEl.classList.remove("show");
  guideEl.classList.remove("show");
  endEl.classList.remove("show");
  hideCoach();
  if (playtestTutorialOn) {
    needsTutorial = true;
    showGuide(0, true);
    return;
  }
  needsTutorial = false;
  tutorialActive = false;
  tutorialCleared = false;
  targetWords = 15;
  await boot(false);
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
menuTutorial.addEventListener("click", () => {
  void togglePlaytestTutorial();
});
menuFeedback.addEventListener("click", () => {
  closeMenu();
});
menuSignout.addEventListener("click", () => {
  void signOut();
});
scoresEl.addEventListener("click", closeScores);
againBtn.addEventListener("click", () => {
  if (tutorialCleared) {
    void finishTutorialAndPlay();
    return;
  }
  if (tutorialActive) {
    void startTutorial();
    return;
  }
  if (submittedToday && !isPlaytest) return;
  void boot(false);
});
seeBoardBtn.addEventListener("click", (e) => {
  void openScores(e);
});
gateForm.addEventListener("submit", (e) => {
  e.preventDefault();
  void submitAuth(gateMode === "signup" ? "claim" : "signin");
});
gateModeBtn.addEventListener("click", () => {
  setGateMode(gateMode === "signin" ? "signup" : "signin");
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

setGateMode("signin");

if (sessionToken) {
  void afterAuth();
} else {
  gateEl.classList.add("show");
}
