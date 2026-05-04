import { registerPlayer } from "./api.js";
import { refreshLeaderboardTable } from "./leaderboard-ui.js";

const STORAGE_KEY = "opsyPlayer";

let domGameListenersAttached = false;
/** @type {(() => void) | undefined} */
let scoresUpdatedListener;
/** @type {(() => void) | undefined} */
let leaderboardRestartListener;

function teardownDomGameListeners() {
  if (scoresUpdatedListener) {
    globalThis.removeEventListener("opsy:scores-updated", scoresUpdatedListener);
    scoresUpdatedListener = undefined;
  }
  const lbBtn = document.getElementById("leaderboard-restart-btn");
  if (lbBtn && leaderboardRestartListener) {
    lbBtn.removeEventListener("click", leaderboardRestartListener);
    leaderboardRestartListener = undefined;
  }
  domGameListenersAttached = false;
}

async function stopPhaserAndShell() {
  try {
    const mod = await import("./main.js?v=20");
    if (typeof mod.destroyOpsyPhaserGame === "function") {
      mod.destroyOpsyPhaserGame();
    }
  } catch {
    /* main.js unload / network — still show join UI below */
  }
  teardownDomGameListeners();
}

function parsePlayerId(rawId) {
  if (typeof rawId === "number" && Number.isInteger(rawId) && rawId >= 1) {
    return rawId;
  }
  const n = parseInt(String(rawId ?? "").trim(), 10);
  return Number.isInteger(n) && n >= 1 ? n : NaN;
}

function getStoredPlayer() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const id = parsePlayerId(p?.id);
    if (
      p &&
      typeof p.username === "string" &&
      p.username.trim() &&
      Number.isFinite(id)
    ) {
      const normalized = {
        id,
        username: p.username.trim(),
        name: typeof p.name === "string" ? p.name.trim() : "",
        email: typeof p.email === "string" ? p.email.trim() : "",
      };
      persistPlayerPayload(normalized);
      return normalized;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Writes the player to localStorage when possible (survives tab/browser restarts).
 * Falls back to sessionStorage if localStorage is unavailable (e.g. some private modes).
 */
function persistPlayerPayload(user) {
  const json = JSON.stringify(user);
  try {
    localStorage.setItem(STORAGE_KEY, json);
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  } catch {
    /* localStorage blocked or full */
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, json);
  } catch {
    throw new Error(
      "This browser blocked saving your player profile. Allow site storage or try a normal (non-private) window.",
    );
  }
}

function setStoredPlayer(user) {
  persistPlayerPayload(user);
}

function removeStoredPlayer() {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

function prefillPlayerForm() {
  const form = document.getElementById("player-form");
  const p = getStoredPlayer();
  syncResumeBanner(p);
  if (!form || !p) return;
  const nameInput = form.querySelector('[name="name"]');
  const userInput = form.querySelector('[name="username"]');
  const emailInput = form.querySelector('[name="email"]');
  if (nameInput instanceof HTMLInputElement) nameInput.value = p.name || "";
  if (userInput instanceof HTMLInputElement) userInput.value = p.username || "";
  if (emailInput instanceof HTMLInputElement) emailInput.value = p.email || "";
}

/**
 * Shows or hides the "we still know who you are" banner above the form. When a
 * stored player exists, the user can resume in one click instead of retyping
 * (and accidentally clicking "Change player" never silently wipes them).
 */
function syncResumeBanner(stored) {
  const banner = document.getElementById("resume-banner");
  const text = document.getElementById("resume-banner-text");
  const keepBtn = document.getElementById("resume-keep-btn");
  if (!banner || !text || !keepBtn) return;
  if (!stored) {
    banner.hidden = true;
    return;
  }
  const label = stored.name?.trim() || stored.username?.trim() || "your saved profile";
  text.textContent = `Welcome back, ${label}. Pick up where you left off?`;
  banner.hidden = false;
}

function showGameShell(_player) {
  const pre = document.getElementById("pre-game");
  const appSection = document.getElementById("app");
  if (pre) pre.hidden = true;
  if (appSection) appSection.hidden = false;
}

function showPreGame() {
  const pre = document.getElementById("pre-game");
  const appSection = document.getElementById("app");
  if (pre) pre.hidden = false;
  if (appSection) appSection.hidden = true;
}

async function loadPhaser(player) {
  const { startGame } = await import("./main.js?v=20");
  startGame(player);

  if (!domGameListenersAttached) {
    domGameListenersAttached = true;
    scoresUpdatedListener = () => {
      const lb = document.getElementById("leaderboard-panel");
      if (lb) lb.hidden = false;
      refreshLeaderboardTable();
    };
    globalThis.addEventListener("opsy:scores-updated", scoresUpdatedListener);

    leaderboardRestartListener = () => {
      globalThis.dispatchEvent(new CustomEvent("opsy:restart-game"));
    };
    document.getElementById("leaderboard-restart-btn")?.addEventListener("click", leaderboardRestartListener);
  }
}

function formErrorMessage(err) {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

async function startApp() {
  const form = document.getElementById("player-form");
  const errEl = document.getElementById("player-form-error");

  /*
   * "Change player" used to wipe the stored profile immediately, which made
   * a single accidental click (the HUD button sits next to "Restart") feel
   * like a hostile logout. We now keep the saved player, just navigate to the
   * pre-game form prefilled — the user can either resume with one click via
   * the banner, edit fields and submit a new identity, or explicitly sign out.
   */
  document.getElementById("change-player-btn")?.addEventListener("click", () => {
    void (async () => {
      await stopPhaserAndShell();
      showPreGame();
      bindJoinFlow();
      prefillPlayerForm();
    })();
  });

  /* Resume banner: jump straight back into the game with the saved profile. */
  document
    .getElementById("resume-keep-btn")
    ?.addEventListener("click", () => {
      void (async () => {
        const stored = getStoredPlayer();
        if (!stored) {
          syncResumeBanner(null);
          return;
        }
        showGameShell(stored);
        try {
          await loadPhaser(stored);
        } catch (err) {
          showPreGame();
          if (errEl) {
            errEl.textContent = formErrorMessage(err);
            errEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
          prefillPlayerForm();
        }
      })();
    });

  /* Explicit sign-out lives behind a confirm so it can never happen by accident. */
  document
    .getElementById("resume-clear-btn")
    ?.addEventListener("click", () => {
      const stored = getStoredPlayer();
      const label =
        stored?.name?.trim() || stored?.username?.trim() || "this profile";
      const ok = globalThis.confirm(
        `Sign out of ${label}? You'll need to enter your details again to play.`,
      );
      if (!ok) return;
      removeStoredPlayer();
      const form = document.getElementById("player-form");
      if (form) {
        const nameInput = form.querySelector('[name="name"]');
        const userInput = form.querySelector('[name="username"]');
        const emailInput = form.querySelector('[name="email"]');
        if (nameInput instanceof HTMLInputElement) nameInput.value = "";
        if (userInput instanceof HTMLInputElement) userInput.value = "";
        if (emailInput instanceof HTMLInputElement) emailInput.value = "";
      }
      syncResumeBanner(null);
    });

  function bindJoinFlow() {
    if (!form || form.dataset.opsyJoinBound === "1") return;
    form.dataset.opsyJoinBound = "1";

    const startBtn = /** @type {HTMLButtonElement | null} */ (
      document.getElementById("opsy-start-game")
    );

    async function runJoin() {
      if (!errEl) return;
      if (form.dataset.opsyJoining === "1") return;
      form.dataset.opsyJoining = "1";

      errEl.textContent = "";

      /* Native validation (required, email format, username pattern). */
      if (!form.checkValidity()) {
        const inv = /** @type {HTMLInputElement | null} */ (
          form.querySelector(":invalid")
        );
        let msg =
          inv?.validationMessage?.trim() ||
          "Please fix the fields above.";
        if (inv?.name === "username") {
          msg +=
            " Username must be a short handle (letters, numbers, . _ -) — use the Email field for your address, not @ here.";
        }
        errEl.textContent = msg;
        errEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        inv?.focus();
        form.dataset.opsyJoining = "0";
        return;
      }

      const fd = new FormData(form);
      const name = String(fd.get("name") ?? "").trim();
      const username = String(fd.get("username") ?? "").trim();
      const email = String(fd.get("email") ?? "").trim();

      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = "Starting...";
      }

      let user;
      try {
        const res = await registerPlayer({ name, username, email });
        user = res.user;
      } catch (err) {
        /* Keep any saved profile — a network or server error must not wipe it. */
        errEl.textContent = formErrorMessage(err);
        errEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        form.dataset.opsyJoining = "0";
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.textContent = "Start game";
        }
        return;
      }

      const uid = parsePlayerId(
        user && typeof user === "object" ? user.id : NaN,
      );
      if (
        !user ||
        typeof user !== "object" ||
        !Number.isFinite(uid) ||
        typeof user.username !== "string" ||
        !user.username.trim()
      ) {
        errEl.textContent =
          "The server returned an unexpected profile. Please try again.";
        errEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        form.dataset.opsyJoining = "0";
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.textContent = "Start game";
        }
        return;
      }

      const profile = {
        id: uid,
        username: user.username.trim(),
        name: typeof user.name === "string" ? user.name.trim() : "",
        email: typeof user.email === "string" ? user.email.trim() : "",
      };

      try {
        setStoredPlayer(profile);
        syncResumeBanner(null);
      } catch (persistErr) {
        showPreGame();
        errEl.textContent = formErrorMessage(persistErr);
        errEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        form.dataset.opsyJoining = "0";
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.textContent = "Start game";
        }
        return;
      }

      showGameShell(profile);
      try {
        await loadPhaser(profile);
      } catch (err) {
        showPreGame();
        errEl.textContent = formErrorMessage(err);
        errEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        prefillPlayerForm();
      } finally {
        form.dataset.opsyJoining = "0";
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.textContent = "Start game";
        }
      }
    }

    startBtn?.addEventListener("click", () => {
      void runJoin();
    });

    /*
     * Rely on the explicit button instead of type=submit — some setups were not
     * delivering the submission path reliably next to inline preventDefault stubs.
     * Enter inside a field still joins the game.
     */
    form.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter") return;
        if (!(e.target instanceof HTMLInputElement)) return;
        e.preventDefault();
        void runJoin();
      },
      true
    );

    /* If the UA ever synthesizes a submit (extensions, autofill), handle it once. */
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void runJoin();
    });
  }

  let stored = getStoredPlayer();

  if (!stored) {
    bindJoinFlow();
  } else {
    showGameShell(stored);
  }

  if (stored) {
    try {
      await loadPhaser(stored);
    } catch (err) {
      showPreGame();
      if (errEl) {
        errEl.textContent = formErrorMessage(err);
        errEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      bindJoinFlow();
      prefillPlayerForm();
    }
  }
}

startApp().catch((err) => {
  const errEl = document.getElementById("player-form-error");
  if (errEl) {
    errEl.textContent = formErrorMessage(err);
    showPreGame();
  }
});
