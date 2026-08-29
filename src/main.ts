import "./style.css";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

// SVG Assets
const LOGO_SVG = `<svg width="200" height="40" viewBox="0 0 200 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <text x="100" y="28" text-anchor="middle" fill="#FFBF00" font-family="Geist" font-weight="800" font-size="24">staaaaack</text>
  <line x1="10" y1="35" x2="190" y2="35" stroke="#FFBF00" stroke-width="2"/>
  <line x1="20" y1="38" x2="180" y2="38" stroke="#FFBF00" stroke-width="2"/>
</svg>`;

const TROPHY_SVG = `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M14 8h16v4h4v4h-4v4h-4v4h-8v-4h-4v-4h-4v-4h4V8z M18 24h8v4h-8v-4z M16 28h12v4H16v-4z" stroke="#9A9A9A" stroke-width="2" fill="none"/>
</svg>`;

// Convex client
const convex = new ConvexClient(import.meta.env.VITE_CONVEX_URL);

// Auth state
let sessionToken: string | null = localStorage.getItem("sessionToken");

// Game state
let todayData: { dayId: string; theme: string; words: string[] } | null = null;
let gameState: "idle" | "adding" | "rebuilding" | "gameover" = "idle";
let stack: string[] = [];
let unusedWords: string[] = [];
let rebuildIndex = 0;
let score = 15;
let passCount = 0;
let timerSeconds = 0;
let timerInterval: number | null = null;
let audioContext: AudioContext | null = null;
let hasSubmittedToday = false;
let timerPaused = false;

// DOM elements
const authOverlay = document.getElementById("auth-overlay")!;
const authHandle = document.getElementById("auth-handle") as HTMLInputElement;
const authPassword = document.getElementById(
  "auth-password"
) as HTMLInputElement;
const authError = document.getElementById("auth-error")!;
const authClaim = document.getElementById("auth-claim")!;
const authSignin = document.getElementById("auth-signin")!;

const onboardingOverlay = document.getElementById("onboarding-overlay")!;
const onboardingDone = document.getElementById("onboarding-done")!;

const leaderboardOverlay = document.getElementById("leaderboard-overlay")!;
const leaderboardContent = document.getElementById("leaderboard-content")!;
const leaderboardClose = document.getElementById("leaderboard-close")!;

const gameScreen = document.getElementById("game-screen")!;
const trophyIcon = document.getElementById("trophy-icon")!;
const stackPane = document.getElementById("stack-pane")!;
const gridContainer = document.getElementById("grid-container")!;
const timerNumber = document.getElementById("timer-number")!;
const timerRingProgress = document.getElementById("timer-ring-progress")!;

const gameOverScreen = document.getElementById("game-over-screen")!;
const finalScore = document.getElementById("final-score")!;
const playAgain = document.getElementById("play-again")!;
const comeBackMessage = document.getElementById("come-back-message")!;

// Initialize
async function init() {
  // Insert SVG assets
  document.getElementById("auth-logo")!.innerHTML = LOGO_SVG;
  document.getElementById("logo-wordmark")!.innerHTML = LOGO_SVG;
  trophyIcon.innerHTML = TROPHY_SVG;

  // Set up event listeners
  authClaim.addEventListener("click", handleClaimHandle);
  authSignin.addEventListener("click", handleSignIn);
  authHandle.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleClaimHandle();
  });
  authPassword.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleClaimHandle();
  });

  onboardingDone.addEventListener("click", handleOnboardingDone);
  trophyIcon.addEventListener("click", showLeaderboard);
  leaderboardClose.addEventListener("click", hideLeaderboard);
  leaderboardOverlay.addEventListener("click", (e) => {
    if (e.target === leaderboardOverlay) hideLeaderboard();
  });
  playAgain.addEventListener("click", startGame);

  // Check auth
  if (sessionToken) {
    await checkAuth();
  } else {
    showAuthOverlay();
  }
}

function showAuthOverlay() {
  authOverlay.classList.remove("hidden");
  gameScreen.classList.add("hidden");
}

function hideAuthOverlay() {
  authOverlay.classList.add("hidden");
  gameScreen.classList.remove("hidden");
}

async function handleClaimHandle() {
  const handle = authHandle.value.trim();
  const password = authPassword.value;

  if (!handle || !password) {
    authError.textContent = "Please enter handle and passphrase";
    return;
  }

  const result = await convex.mutation(api.players.claimHandle, {
    handle,
    password,
  });

  if (result.success && result.token) {
    sessionToken = result.token;
    localStorage.setItem("sessionToken", result.token);
    authError.textContent = "";
    await checkAuth();
  } else {
    authError.textContent = result.error || "Failed to claim handle";
  }
}

async function handleSignIn() {
  const handle = authHandle.value.trim();
  const password = authPassword.value;

  if (!handle || !password) {
    authError.textContent = "Please enter handle and passphrase";
    return;
  }

  const result = await convex.mutation(api.players.signIn, {
    handle,
    password,
  });

  if (result.success && result.token) {
    sessionToken = result.token;
    localStorage.setItem("sessionToken", result.token);
    authError.textContent = "";
    await checkAuth();
  } else {
    authError.textContent = result.error || "Failed to sign in";
  }
}

async function checkAuth() {
  if (!sessionToken) {
    showAuthOverlay();
    return;
  }

  const player = await convex.query(api.players.getMe, { sessionToken });

  if (!player) {
    sessionToken = null;
    localStorage.removeItem("sessionToken");
    showAuthOverlay();
    return;
  }

  hideAuthOverlay();

  // Check if onboarded
  if (!player.onboarded) {
    showOnboarding();
  } else {
    await loadGame();
  }
}

function showOnboarding() {
  onboardingOverlay.classList.remove("hidden");
}

async function handleOnboardingDone() {
  if (sessionToken) {
    await convex.mutation(api.players.completeOnboarding, { sessionToken });
    onboardingOverlay.classList.add("hidden");
    await loadGame();
  }
}

async function loadGame() {
  // Get today's data
  todayData = await convex.query(api.game.getToday, {});

  // Check if already submitted
  if (sessionToken) {
    const submitStatus = await convex.query(api.game.checkTodaySubmitted, {
      sessionToken,
    });

    if (submitStatus && submitStatus.submitted) {
      hasSubmittedToday = true;
      if (submitStatus.run) {
        showGameOver(submitStatus.run.score, true);
      }
      return;
    }
  }

  hasSubmittedToday = false;
  startGame();
}

function startGame() {
  if (hasSubmittedToday) return;

  gameOverScreen.classList.add("hidden");
  stack = [];
  unusedWords = [...(todayData?.words || [])];
  rebuildIndex = 0;
  score = 15;
  passCount = 0;
  gameState = "adding";

  renderStack();
  renderGrid();
  startTimer(getTimerForStackSize(1));
}

function renderStack() {
  stackPane.innerHTML = stack
    .map((word) => `<div class="stack-word">${word}</div>`)
    .join("");
}

function renderGrid() {
  gridContainer.innerHTML = "";

  if (!todayData) return;

  todayData.words.forEach((word) => {
    const button = document.createElement("button");
    button.className = "word-pill";
    button.textContent = word;

    if (gameState === "adding") {
      if (stack.includes(word)) {
        button.classList.add("in-stack");
      } else {
        button.classList.add("available");
        button.addEventListener("click", () => handleAddClick(word));
      }
    } else if (gameState === "rebuilding") {
      button.classList.add("available");
      button.addEventListener("click", () => handleRebuildClick(word));
    }

    gridContainer.appendChild(button);
  });
}

async function handleAddClick(word: string) {
  if (gameState !== "adding" || stack.includes(word)) return;

  // Add player's word
  stack.push(word);
  unusedWords = unusedWords.filter((w) => w !== word);
  renderStack();
  renderGrid();

  // Computer adds after delay
  setTimeout(() => {
    if (unusedWords.length > 0 && gameState === "adding") {
      const randomWord =
        unusedWords[Math.floor(Math.random() * unusedWords.length)];
      stack.push(randomWord);
      unusedWords = unusedWords.filter((w) => w !== randomWord);
      renderStack();
      renderGrid();

      // Check if we should start rebuild
      if (unusedWords.length === 0 || stack.length >= 15) {
        setTimeout(() => startRebuild(), 350);
      }
    }
  }, 350);
}

async function startRebuild() {
  gameState = "rebuilding";
  rebuildIndex = 0;

  playBeep(440);
  await shuffleGrid();

  // Clear stack display but keep the array
  stackPane.innerHTML = "";
  renderGrid();
}

async function shuffleGrid() {
  const pills = Array.from(
    gridContainer.querySelectorAll(".word-pill")
  ) as HTMLElement[];

  // Store original positions
  const positions = pills.map((pill) => ({
    pill,
    rect: pill.getBoundingClientRect(),
  }));

  // Shuffle array
  for (let i = pills.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pills[i], pills[j]] = [pills[j], pills[i]];
  }

  // Apply new order to DOM
  gridContainer.innerHTML = "";
  pills.forEach((pill) => gridContainer.appendChild(pill));

  // Get new positions
  const newPositions = pills.map((pill) => ({
    pill,
    rect: pill.getBoundingClientRect(),
  }));

  // Calculate and apply transforms
  positions.forEach((oldPos) => {
    const newPos = newPositions.find((np) => np.pill === oldPos.pill);
    if (newPos) {
      const deltaX = oldPos.rect.left - newPos.rect.left;
      const deltaY = oldPos.rect.top - newPos.rect.top;

      oldPos.pill.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      oldPos.pill.classList.add("shuffling");
    }
  });

  // Animate to new positions
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      pills.forEach((pill) => {
        pill.style.transform = "";
      });

      setTimeout(() => {
        pills.forEach((pill) => pill.classList.remove("shuffling"));
        resolve(null);
      }, 480);
    });
  });
}

function handleRebuildClick(word: string) {
  if (gameState !== "rebuilding") return;

  const expected = stack[rebuildIndex];

  if (word === expected) {
    // Correct!
    rebuildIndex++;

    // Add to stack display
    const stackWord = document.createElement("div");
    stackWord.className = "stack-word";
    stackWord.textContent = word;
    stackPane.insertBefore(stackWord, stackPane.firstChild);

    if (rebuildIndex >= stack.length) {
      // Pass complete!
      handlePassComplete();
    }
  } else {
    // Wrong!
    endGame();
  }
}

async function handlePassComplete() {
  passCount++;

  if (stack.length >= 15) {
    // Endurance mode
    score *= 2;
    rebuildIndex = 0;

    // Calculate new timer based on pass count
    const newTimer = getEnduranceTimer(passCount);
    stopTimer();
    startTimer(newTimer);

    playBeep(440);
    await shuffleGrid();

    stackPane.innerHTML = "";
    gameState = "rebuilding";
    renderGrid();
  } else {
    // Continue adding
    gameState = "adding";
    stopTimer();
    startTimer(getTimerForStackSize(stack.length + 1));
    renderGrid();
  }
}

function getTimerForStackSize(size: number): number {
  if (size <= 5) return 12;
  if (size <= 10) return 18;
  return 24;
}

function getEnduranceTimer(pass: number): number {
  if (pass === 1) return 24;
  if (pass === 2) return 18;
  if (pass === 3) return 13;
  if (pass === 4) return 10;
  return 8;
}

function startTimer(seconds: number) {
  timerSeconds = seconds;
  timerPaused = false;
  updateTimerDisplay();

  timerInterval = window.setInterval(() => {
    if (timerPaused) return;

    timerSeconds -= 0.1;

    if (timerSeconds <= 1 && timerSeconds > 0) {
      playBeep(880);
    }

    if (timerSeconds <= 0) {
      endGame();
    }

    updateTimerDisplay();
  }, 100);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function pauseTimer() {
  timerPaused = true;
}

function resumeTimer() {
  timerPaused = false;
}

function updateTimerDisplay() {
  const displaySeconds = Math.ceil(Math.max(0, timerSeconds));
  timerNumber.textContent = displaySeconds.toString();

  // Update ring
  const maxTime = gameState === "adding" ? getTimerForStackSize(stack.length || 1) : getEnduranceTimer(passCount);
  const progress = timerSeconds / maxTime;
  const circumference = 2 * Math.PI * 45;
  const offset = circumference * (1 - progress);
  timerRingProgress.style.strokeDashoffset = offset.toString();
}

function playBeep(frequency: number) {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.frequency.value = frequency;
  oscillator.type = "sine";

  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(
    0.01,
    audioContext.currentTime + 0.1
  );

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.1);
}

async function endGame() {
  stopTimer();
  gameState = "gameover";

  // Submit score
  if (sessionToken && !hasSubmittedToday) {
    const result = await convex.mutation(api.game.submitRun, {
      sessionToken,
      score,
    });

    if (result.success) {
      hasSubmittedToday = true;
    }
  }

  showGameOver(score, hasSubmittedToday);
}

function showGameOver(finalScoreValue: number, submitted: boolean) {
  gameOverScreen.classList.remove("hidden");
  finalScore.textContent = finalScoreValue.toString();

  if (submitted) {
    playAgain.style.display = "none";
    comeBackMessage.classList.remove("hidden");
  } else {
    playAgain.style.display = "block";
    comeBackMessage.classList.add("hidden");
  }
}

async function showLeaderboard() {
  pauseTimer();
  leaderboardOverlay.classList.remove("hidden");

  const leaders = await convex.query(api.game.leaderboard, {});

  leaderboardContent.innerHTML = leaders
    .map(
      (entry, index) => `
    <div class="leaderboard-row">
      <div class="leaderboard-rank">${index + 1}</div>
      <div class="leaderboard-info">
        <div class="leaderboard-handle">${entry.handle}</div>
        <div class="leaderboard-theme">${entry.theme}</div>
      </div>
      <div class="leaderboard-score">${entry.score}</div>
    </div>
  `
    )
    .join("");
}

function hideLeaderboard() {
  leaderboardOverlay.classList.add("hidden");
  resumeTimer();
}

// Start the app
init();
