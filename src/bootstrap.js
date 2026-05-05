import { registerPlayer } from "./api.js";
import { refreshLeaderboardTable } from "./leaderboard-ui.js";

const STORAGE_KEY = "opsyPlayer";

let domGameListenersAttached = false;
let gameReadyListenerAttached = false;
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
  clearPendingLandscapeListener();
  setGameLoadingVisible(false);
  try {
    const mod = await import("./main.js?v=24");
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
  /*
   * While the join form is showing, portrait is allowed. Once we enter the game
   * shell, CSS may show the rotate-to-landscape overlay on phones until the user
   * turns sideways (see .opsy-game-shell in style.css).
   */
  document.body.classList.add("opsy-game-shell");
}

function showPreGame() {
  const pre = document.getElementById("pre-game");
  const appSection = document.getElementById("app");
  if (pre) pre.hidden = false;
  if (appSection) appSection.hidden = true;
  document.body.classList.remove("opsy-game-shell");
}

/**
 * Coarse-pointer phones in portrait (< ~900px) are blocked from playing by the
 * rotate-to-landscape overlay; if we boot Phaser into a `display:none` parent
 * the canvas inits at 0×0 and the loading overlay can stay stuck forever after
 * the user rotates. Defer Phaser until we're actually in landscape.
 */
function isMobilePortrait() {
  try {
    return (
      globalThis.matchMedia?.("(orientation: portrait)").matches === true &&
      globalThis.matchMedia?.("(hover: none) and (pointer: coarse)").matches ===
        true &&
      (globalThis.innerWidth || 0) <= 900
    );
  } catch {
    return false;
  }
}

/** @type {(() => void) | undefined} */
let pendingLandscapeListener;

function clearPendingLandscapeListener() {
  if (!pendingLandscapeListener) return;
  globalThis.removeEventListener("resize", pendingLandscapeListener);
  globalThis.removeEventListener("orientationchange", pendingLandscapeListener);
  pendingLandscapeListener = undefined;
}

/**
 * Loads Phaser now if the device is ready (desktop, tablet landscape, or any
 * non-coarse pointer); otherwise waits for the next orientation/resize event
 * that escapes mobile portrait, then loads. Returns a promise that resolves /
 * rejects with the underlying loadPhaser call.
 */
function loadPhaserWhenLandscape(player) {
  if (!isMobilePortrait()) {
    return loadPhaser(player);
  }
  clearPendingLandscapeListener();
  return new Promise((resolve, reject) => {
    pendingLandscapeListener = () => {
      if (isMobilePortrait()) return;
      clearPendingLandscapeListener();
      loadPhaser(player).then(resolve, reject);
    };
    globalThis.addEventListener("resize", pendingLandscapeListener);
    globalThis.addEventListener("orientationchange", pendingLandscapeListener);
  });
}

/** After this long with no game-ready event, surface a reload escape hatch. */
const LOADING_OVERLAY_RELOAD_MS = 30_000;
/** @type {number | undefined} */
let loadingReloadTimer;
let reloadBtnBound = false;

function setLoadingProgress(value) {
  const fill = document.getElementById("game-loading-fill");
  const pct = document.getElementById("game-loading-percent");
  const bar = document.getElementById("game-loading-bar");
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  if (fill) fill.style.transform = `scaleX(${v})`;
  if (pct) pct.textContent = `${Math.round(v * 100)}%`;
  if (bar) bar.setAttribute("aria-valuenow", String(Math.round(v * 100)));
}

function ensureReloadButtonBound() {
  if (reloadBtnBound) return;
  const btn = document.getElementById("game-loading-reload-btn");
  if (!btn) return;
  reloadBtnBound = true;
  btn.addEventListener("click", () => {
    location.reload();
  });
}

function setGameLoadingVisible(visible) {
  const el = document.getElementById("game-loading-overlay");
  const reloadBtn = document.getElementById("game-loading-reload-btn");
  if (!el) return;
  el.hidden = !visible;
  el.setAttribute("aria-busy", visible ? "true" : "false");
  if (visible) {
    setLoadingProgress(0);
    if (reloadBtn) reloadBtn.hidden = true;
    ensureReloadButtonBound();
    if (loadingReloadTimer) globalThis.clearTimeout(loadingReloadTimer);
    loadingReloadTimer = globalThis.setTimeout(() => {
      if (reloadBtn) reloadBtn.hidden = false;
    }, LOADING_OVERLAY_RELOAD_MS);
  } else {
    if (reloadBtn) reloadBtn.hidden = true;
    if (loadingReloadTimer) {
      globalThis.clearTimeout(loadingReloadTimer);
      loadingReloadTimer = undefined;
    }
  }
}

/** Hide loading once any playable scene activates (BootScene + GameScene both fire). */
function ensureGameReadyListener() {
  if (gameReadyListenerAttached) return;
  gameReadyListenerAttached = true;
  globalThis.addEventListener("opsy:game-ready", () => setGameLoadingVisible(false));
  globalThis.addEventListener("opsy:load-progress", (e) => {
    const detail = /** @type {CustomEvent} */ (e).detail;
    if (detail && typeof detail.progress === "number") {
      setLoadingProgress(detail.progress);
    }
  });
  /*
   * If Phaser's loader signals a per-asset failure (404, decode killed by
   * iOS image-memory limit, network drop), surface it on the loading
   * overlay text and unhide the reload escape-hatch immediately. Without
   * this, the spinner sits at the partial progress forever.
   */
  globalThis.addEventListener("opsy:load-error", (e) => {
    const detail = /** @type {CustomEvent} */ (e).detail;
    const text = document.querySelector(".game-loading-text");
    const reloadBtn = document.getElementById("game-loading-reload-btn");
    if (text) {
      const which = detail?.key ? `“${detail.key}”` : "an asset";
      text.textContent = `Could not load ${which}. Tap reload to try again.`;
    }
    if (reloadBtn) reloadBtn.hidden = false;
  });
}

/**
 * iPhone Safari (and therefore iOS Chrome / Firefox, which all use WebKit
 * under Apple's rules) does NOT implement Fullscreen API on regular DOM
 * elements — only on `<video>`. Detect that up front so we can show a
 * helpful tooltip instead of silently doing nothing when the user taps the
 * fullscreen button.
 *
 * Already-installed PWA (`display-mode: standalone`) is effectively
 * fullscreen on iPhone; same for tabs that are already in fullscreen.
 */
function fullscreenApiSupported() {
  const el = /** @type {any} */ (document.documentElement);
  return Boolean(el.requestFullscreen || el.webkitRequestFullscreen);
}

function isStandalonePwa() {
  try {
    if (globalThis.matchMedia?.("(display-mode: standalone)").matches) {
      return true;
    }
  } catch {
    /* matchMedia unsupported */
  }
  return Boolean(/** @type {any} */ (globalThis.navigator)?.standalone);
}

function isIosLikeDevice() {
  const ua = String(globalThis.navigator?.userAgent || "");
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  /* iPadOS 13+ reports as MacIntel + touch points. */
  return (
    ua.includes("Mac") &&
    typeof globalThis.navigator?.maxTouchPoints === "number" &&
    globalThis.navigator.maxTouchPoints > 1
  );
}

/**
 * Best-effort fullscreen — modern Chromium / Firefox / Safari iPad all honour
 * the request; iPhone Safari ignores fullscreen on non-video elements (PWA
 * "Add to Home Screen" is the workaround there). Must be called from a user
 * gesture or browsers will reject.
 */
function requestPageFullscreen() {
  const target = /** @type {any} */ (document.documentElement);
  try {
    if (target.requestFullscreen) {
      target.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    } else if (target.webkitRequestFullscreen) {
      target.webkitRequestFullscreen();
    }
  } catch {
    /* fullscreen unsupported / blocked — silently fall back to non-fullscreen */
  }
}

function isFullscreen() {
  return Boolean(
    document.fullscreenElement ||
      /** @type {any} */ (document).webkitFullscreenElement
  );
}

function exitPageFullscreen() {
  try {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (/** @type {any} */ (document).webkitExitFullscreen) {
      /** @type {any} */ (document).webkitExitFullscreen();
    }
  } catch {
    /* ignore */
  }
}

function toggleFullscreen() {
  if (isFullscreen()) exitPageFullscreen();
  else requestPageFullscreen();
}

function syncFullscreenButton() {
  const btn = document.getElementById("fullscreen-toggle-btn");
  if (!btn) return;
  btn.setAttribute("aria-pressed", isFullscreen() ? "true" : "false");
  btn.title = isFullscreen() ? "Exit fullscreen" : "Enter fullscreen";
}

/**
 * iPhone fallback when there is no Fullscreen API: show a small tooltip
 * pointing the user at "Add to Home Screen" (the PWA path that Apple does
 * allow to run fullscreen). Tooltip auto-dismisses on next tap anywhere or
 * after a few seconds — there is nothing for the button to actually toggle.
 */
function showIosFullscreenHint(anchorBtn) {
  const existing = document.getElementById("ios-fullscreen-hint");
  if (existing) {
    existing.remove();
    return;
  }
  const tip = document.createElement("div");
  tip.id = "ios-fullscreen-hint";
  tip.className = "ios-fullscreen-hint";
  tip.setAttribute("role", "tooltip");
  tip.textContent =
    "iPhone blocks in-page fullscreen. For true fullscreen: tap the Share icon in Safari → Add to Home Screen, then open Opsy Wopsy from the home screen.";
  document.body.appendChild(tip);
  const dismiss = () => {
    tip.remove();
    document.removeEventListener("pointerdown", onDocPointer, true);
    if (timer) globalThis.clearTimeout(timer);
  };
  function onDocPointer(e) {
    if (e.target === anchorBtn || tip.contains(/** @type {Node} */ (e.target))) {
      return;
    }
    dismiss();
  }
  /* Defer so the click that opened the tooltip doesn't immediately close it. */
  setTimeout(() => {
    document.addEventListener("pointerdown", onDocPointer, true);
  }, 0);
  const timer = globalThis.setTimeout(dismiss, 7000);
}

function bindFullscreenControls() {
  const btn = document.getElementById("fullscreen-toggle-btn");
  if (!btn) return;
  /*
   * Hide the button entirely when fullscreen would be a no-op:
   *   - already running as an installed PWA (effectively fullscreen)
   *   - iPhone Safari without the Fullscreen API and not yet a PWA: the
   *     button used to silently fail; surface a tooltip pointing at the
   *     Share → Add to Home Screen workaround instead.
   */
  if (isStandalonePwa()) {
    btn.hidden = true;
    return;
  }
  if (btn.dataset.opsyBound !== "1") {
    btn.dataset.opsyBound = "1";
    btn.addEventListener("click", () => {
      if (!fullscreenApiSupported() && isIosLikeDevice()) {
        showIosFullscreenHint(btn);
        return;
      }
      toggleFullscreen();
    });
  }
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  document.addEventListener("webkitfullscreenchange", syncFullscreenButton);
  syncFullscreenButton();
}

async function loadPhaser(player) {
  ensureGameReadyListener();
  setGameLoadingVisible(true);
  try {
    const { startGame } = await import("./main.js?v=24");
    startGame(player);
  } catch (err) {
    setGameLoadingVisible(false);
    throw err;
  }

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

  bindFullscreenControls();

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
        /* User-initiated click — request fullscreen here; later code paths run
           after `await` and would lose the gesture. */
        requestPageFullscreen();
        showGameShell(stored);
        try {
          await loadPhaserWhenLandscape(stored);
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

      /* Still inside the click gesture — fullscreen request would be rejected
         after the network round-trip below, so fire it now. */
      requestPageFullscreen();

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
        await loadPhaserWhenLandscape(profile);
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

  /*
   * Always land on the join form first — even when a stored player exists.
   *
   * Auto-jumping straight into the game shell on resume meant phones in
   * portrait got the rotate-to-landscape overlay before they ever saw the
   * resume banner, so anyone who wanted to switch profiles was trapped under
   * "Rotate your phone" with no way to reach the form. Showing pre-game first
   * keeps login + the one-tap resume banner usable in portrait, and only the
   * actual gameplay requires landscape.
   */
  bindJoinFlow();
  prefillPlayerForm();
  showPreGame();
}

startApp().catch((err) => {
  const errEl = document.getElementById("player-form-error");
  if (errEl) {
    errEl.textContent = formErrorMessage(err);
    showPreGame();
  }
});
