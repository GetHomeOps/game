/*
 * Cache-bust every scene module on the SAME version, so a phone never loads
 * a stale Boot/Start scene against a fresh GameScene (or vice-versa). The
 * previous setup only versioned GameScene, which let iOS Chrome reuse a
 * cached BootScene that pointed at oversized (and then re-encoded) PNGs and
 * made the dog render at the wrong proportions. Bump SCENE_CACHE_VERSION
 * any time you touch BootScene, StartScene, or GameScene.
 */
import BootScene from "./scenes/BootScene.js?v=5";
import StartScene from "./scenes/StartScene.js?v=5";
import GameScene from "./scenes/GameScene.js?v=5";

const Phaser = globalThis.Phaser;
if (!Phaser) {
  throw new Error(
    "Phaser missing: ensure phaser.min.js loads before this module in index.html."
  );
}

/**
 * Returns true if Phaser's global PluginCache still has its core plugins
 * registered. A previous `Game#destroy(true, true)` (noReturn) wipes them, after
 * which any new `Phaser.Game(...)` aborts with "Core Plugins missing." The only
 * way to repopulate the cache is to re-evaluate the Phaser bundle, i.e. a full
 * page reload.
 */
function corePluginsAvailable() {
  try {
    return Boolean(
      Phaser?.Plugins?.PluginCache?.hasCore?.("EventEmitter")
    );
  } catch {
    return false;
  }
}

/**
 * @param {{ id: number; name: string; username: string; email: string } | null} player
 */
export function startGame(player) {
  if (!corePluginsAvailable()) {
    /* A prior session destroyed the cache (older builds called destroy(true, true)).
       The bundle can't be repaired in-place; force a one-shot reload so the user
       sees the game instead of an empty stage with "Core Plugins missing.". */
    if (!sessionStorage.getItem("opsyPhaserCacheReload")) {
      sessionStorage.setItem("opsyPhaserCacheReload", "1");
      location.reload();
      return;
    }
    throw new Error(
      "Phaser plugin cache is empty after reload. Hard-refresh the page (Cmd+Shift+R / Ctrl+Shift+R) to recover."
    );
  }
  sessionStorage.removeItem("opsyPhaserCacheReload");

  const config = {
    type: Phaser.AUTO,
    parent: "game-container",
    width: 960,
    height: 540,
    /* Match interior art / HUD cream so sub-pixel seam gaps at zone joins never flash sky blue. */
    backgroundColor: "#fff1d6",
    pixelArt: false,
    render: {
      roundPixels: true,
    },
    input: {
      activePointers: 3,
    },
    physics: {
      default: "arcade",
      arcade: {
        gravity: { y: 1200 },
        debug: false,
      },
    },
    scene: [BootScene, StartScene, GameScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      /*
       * `expandParent: false` keeps Phaser from rewriting `#game-container`'s
       * inline width/height to its own snap-fit values — we already drive the
       * parent size via CSS (`100dvh`/`100vw`), and letting Phaser fight us
       * on iOS Safari + iPhone PWA caused the canvas to size past the bottom
       * of the visible viewport (painted floor cropped, dog mid-air).
       */
      expandParent: false,
    },
    callbacks: {
      preBoot(game) {
        if (player) {
          game.registry.set("player", player);
        }
      },
    },
  };

  const existing = /** @type {Phaser.Game | undefined} */ (
    globalThis.__opsyPhaserGame
  );
  if (existing) {
    destroyOpsyPhaserGame(existing);
  }

  /* Sync the JS-measured viewport height into `--opsy-vh` BEFORE Phaser
     reads `#game-container` dimensions. Otherwise Phaser's first scale
     calc on iPhone PWA can latch onto an inflated `100dvh` value and ship
     a canvas taller than the visible area, dropping the painted floor
     off-screen until a later refit corrects it. */
  syncOpsyViewportHeight();

  const game = new Phaser.Game(config);
  globalThis.__opsyPhaserGame = game;
  if (player) {
    game.registry.set("player", player);
  }
  attachViewportRefitListeners(game);
}

/**
 * Mirror `visualViewport.height` (the iOS-correct visible CSS pixel count)
 * onto `--opsy-vh` as the per-1vh value, so CSS can use
 * `calc(var(--opsy-vh) * 100)` in places where iOS may report 100dvh too
 * large (iPhone PWA landscape primarily).
 */
function syncOpsyViewportHeight() {
  const win = /** @type {any} */ (globalThis);
  const h = win.visualViewport?.height || win.innerHeight || 0;
  if (h > 0) {
    document.documentElement.style.setProperty("--opsy-vh", `${h / 100}px`);
  }
}

/**
 * Re-fit the Phaser canvas whenever the visible viewport changes.
 *
 * iOS Safari doesn't fire `window.resize` when its URL bar collapses or
 * expands in landscape (only the *visual* viewport changes). iPhone PWA
 * ("Add to Home Screen") in landscape also reports unstable viewport
 * dimensions for ~1 second after first paint, so the canvas Phaser sized
 * at boot ends up taller or shorter than the actually visible area —
 * which in a CENTER_BOTH layout drops the painted floor below the screen
 * (the dog appears to run mid-air) or leaves cream bands above.
 *
 * We watch:
 *   - `ResizeObserver` on `#game-container` — catches every layout change
 *     including iOS quirks where neither `resize` nor `visualViewport`
 *     fires but the parent's CSS-resolved height is now different.
 *   - `visualViewport.resize` — URL bar collapse, soft keyboard, dynamic
 *     island layout shifts.
 *   - `orientationchange` + `pageshow` — orientation flips, bfcache.
 *
 * We also schedule three delayed refits (50ms / 250ms / 1000ms) after
 * boot so iPhone PWA, where layout settles asynchronously after the first
 * frame, still ends up with the canvas snapped to the real viewport.
 */
function attachViewportRefitListeners(game) {
  if (!game) return;

  let scheduled = false;
  const refit = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncOpsyViewportHeight();
      try {
        game.scale?.refresh?.();
      } catch {
        /* game already destroyed — listeners cleaned up below */
      }
    });
  };

  const win = /** @type {any} */ (globalThis);
  const vv = win.visualViewport;
  vv?.addEventListener?.("resize", refit);
  vv?.addEventListener?.("scroll", refit);
  win.addEventListener("orientationchange", refit);
  win.addEventListener("pageshow", refit);

  /** @type {ResizeObserver | undefined} */
  let observer;
  const parent = document.getElementById("game-container");
  if (parent && typeof win.ResizeObserver === "function") {
    observer = new win.ResizeObserver(() => refit());
    observer.observe(parent);
  }

  /* iPhone PWA: viewport metrics aren't stable on the first frames after
     boot (status bar + home indicator chrome animates in). Retry the fit a
     few times so we end up locked to the real visible area even if no
     resize event ever fires. */
  const safetyTimers = [50, 250, 1000].map((ms) =>
    win.setTimeout(refit, ms)
  );

  game.events?.once?.(Phaser.Core.Events.DESTROY, () => {
    vv?.removeEventListener?.("resize", refit);
    vv?.removeEventListener?.("scroll", refit);
    win.removeEventListener("orientationchange", refit);
    win.removeEventListener("pageshow", refit);
    observer?.disconnect?.();
    safetyTimers.forEach((t) => win.clearTimeout(t));
  });
}

/** Shut down Phaser cleanly (canvas removed from #game-container) without reloading the page. */
export function destroyOpsyPhaserGame(gameArg) {
  const g =
    gameArg ??
    /** @type {Phaser.Game | undefined} */ (globalThis.__opsyPhaserGame);
  if (!g) return;
  try {
    /* Second arg must be false so core plugins stay registered — true = "noReturn" and breaks the next Phaser.Game on this page. */
    g.destroy(true, false);
  } catch {
    /* ignore */
  }
  globalThis.__opsyPhaserGame = undefined;
}
