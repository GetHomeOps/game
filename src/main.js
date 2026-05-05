/*
 * Cache-bust every scene module on the SAME version, so a phone never loads
 * a stale Boot/Start scene against a fresh GameScene (or vice-versa). The
 * previous setup only versioned GameScene, which let iOS Chrome reuse a
 * cached BootScene that pointed at oversized (and then re-encoded) PNGs and
 * made the dog render at the wrong proportions. Bump SCENE_CACHE_VERSION
 * any time you touch BootScene, StartScene, or GameScene.
 */
import BootScene from "./scenes/BootScene.js?v=4";
import StartScene from "./scenes/StartScene.js?v=4";
import GameScene from "./scenes/GameScene.js?v=4";

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

  const game = new Phaser.Game(config);
  globalThis.__opsyPhaserGame = game;
  if (player) {
    game.registry.set("player", player);
  }
  attachViewportRefitListeners(game);
}

/**
 * iOS Safari does NOT fire `window.resize` when the URL bar collapses or
 * expands in landscape (only the *visual* viewport changes; the layout
 * viewport stays put). Phaser's Scale.FIT handler is wired to `resize`, so
 * the canvas keeps the dimensions from boot — which on iPhone landscape is
 * the smaller viewport with the URL bar visible. Once the bar collapses, the
 * `#game-container` (`height: 100dvh`) grows but the canvas does not, and
 * `CENTER_BOTH` leaves cream bands above/below.
 *
 * Listen for `visualViewport` resize + `orientationchange` and call
 * `game.scale.refresh()` so the canvas re-fits the currently visible area.
 */
function attachViewportRefitListeners(game) {
  if (!game) return;

  let scheduled = false;
  const refit = () => {
    if (scheduled) return;
    scheduled = true;
    /* Wait one frame so the browser has finished updating viewport metrics
       before we read them — calling refresh() inside the resize event itself
       reads stale dimensions on iOS Safari. */
    requestAnimationFrame(() => {
      scheduled = false;
      try {
        game.scale?.refresh?.();
      } catch {
        /* game already destroyed — listeners removed below */
      }
    });
  };

  const win = /** @type {any} */ (globalThis);
  const vv = win.visualViewport;
  vv?.addEventListener?.("resize", refit);
  win.addEventListener("orientationchange", refit);
  /* `pageshow` fires after iOS Safari restores from bfcache (e.g. after
     coming back from another tab) — viewport dims may differ from boot. */
  win.addEventListener("pageshow", refit);

  game.events?.once?.(Phaser.Core.Events.DESTROY, () => {
    vv?.removeEventListener?.("resize", refit);
    win.removeEventListener("orientationchange", refit);
    win.removeEventListener("pageshow", refit);
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
