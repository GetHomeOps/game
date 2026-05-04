import BootScene from "./scenes/BootScene.js";
import StartScene from "./scenes/StartScene.js";
import GameScene from "./scenes/GameScene.js";

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
    backgroundColor: "#fff8ee",
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
