const Phaser = globalThis.Phaser;
if (!Phaser) {
  throw new Error("Phaser not loaded — check script order in index.html.");
}

/* Individual run cycle frames (square 1254×1254 PNGs). */
const PLAYER_RUN_FILES = [
  "ChatGPT Image May 4, 2026, 10_19_33 AM (1).png",
  "ChatGPT Image May 4, 2026, 10_19_33 AM (2).png",
  "ChatGPT Image May 4, 2026, 10_19_34 AM (3).png",
  "ChatGPT Image May 4, 2026, 10_19_34 AM (4).png",
  "ChatGPT Image May 4, 2026, 10_19_34 AM (5).png",
  "ChatGPT Image May 4, 2026, 10_19_35 AM (6).png",
  "ChatGPT Image May 4, 2026, 10_19_35 AM (7).png",
  "ChatGPT Image May 4, 2026, 10_19_35 AM (8).png",
];

const PLAYER_IDLE_FILE = "ChatGPT Image May 4, 2026, 10_20_29 AM (1).png";
/* Jump uses the same asset as idle — a clear mid-air or stand pose. */
const HUD_DOG_FILE = "opsy_head_hud.png";

const PLAYER_ASSET_DIR = new URL("../assets/opsy_running_new/", import.meta.url);
const HAZARD_ASSET_DIR = new URL("../assets/hazards_new/", import.meta.url);
const UI_ASSET_DIR = new URL("../assets/ui/", import.meta.url);
const OPSY_END_ASSET_DIR = new URL("../assets/opsy_end/", import.meta.url);
const OPSY_END_FILE = "ChatGPT Image May 4, 2026, 06_39_07 PM.png";

const HAZARD_FILES = [
  { key: "hazard_pipe_leak", file: "ChatGPT Image May 4, 2026, 10_51_07 AM (1).png" },
  { key: "hazard_furnace", file: "ChatGPT Image May 4, 2026, 10_51_07 AM (2).png" },
  { key: "hazard_gutter", file: "ChatGPT Image May 4, 2026, 10_51_08 AM (3).png" },
  { key: "hazard_vent", file: "ChatGPT Image May 4, 2026, 10_51_08 AM (4).png" },
  { key: "hazard_floorboards", file: "ChatGPT Image May 4, 2026, 10_51_08 AM (5).png" },
  { key: "hazard_boiler", file: "ChatGPT Image May 4, 2026, 10_51_09 AM (6).png" },
  { key: "hazard_breaker", file: "ChatGPT Image May 4, 2026, 06_17_51 PM (1).png" },
  { key: "hazard_toilet", file: "ChatGPT Image May 4, 2026, 06_17_51 PM (2).png" },
  { key: "hazard_broken_stairs", file: "ChatGPT Image May 4, 2026, 06_17_52 PM (3).png" },
];

function playerAssetHref(filename) {
  return new URL(filename, PLAYER_ASSET_DIR).href;
}

function hazardAssetHref(filename) {
  return new URL(filename, HAZARD_ASSET_DIR).href;
}

function uiAssetHref(filename) {
  return new URL(filename, UI_ASSET_DIR).href;
}

function opsyEndAssetHref(filename) {
  return new URL(filename, OPSY_END_ASSET_DIR).href;
}

/**
 * `opsy_running_new` PNGs are RGB (no alpha) with a flat light backdrop. Remove
 * pixels reachable from the image border through bright, low-chroma colours so
 * the dog and coloured pixels stay opaque while the margin goes transparent.
 */
function keyOutRgbBackdrop(scene, textureKey) {
  if (!scene.textures.exists(textureKey)) return;

  const tex = scene.textures.get(textureKey);
  const img = tex.getSourceImage();
  if (!img) return;

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const { data } = ctx.getImageData(0, 0, w, h);
  const stride = w;
  const total = w * h;

  function isBackdropAt(idx) {
    const o = idx * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    const lum = (r + g + b) / 3;
    return lum >= 232 && hi - lo <= 34;
  }

  const visited = new Uint8Array(total);
  const stack = [];

  function seed(x, y) {
    const i = y * stride + x;
    if (visited[i] || !isBackdropAt(i)) return;
    visited[i] = 1;
    stack.push(i);
  }

  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }

  while (stack.length > 0) {
    const i = stack.pop();
    const o = i * 4;
    data[o + 3] = 0;
    const x = i % stride;
    const y = (i / stride) | 0;
    if (x > 0) {
      const n = i - 1;
      if (!visited[n] && isBackdropAt(n)) {
        visited[n] = 1;
        stack.push(n);
      }
    }
    if (x < w - 1) {
      const n = i + 1;
      if (!visited[n] && isBackdropAt(n)) {
        visited[n] = 1;
        stack.push(n);
      }
    }
    if (y > 0) {
      const n = i - stride;
      if (!visited[n] && isBackdropAt(n)) {
        visited[n] = 1;
        stack.push(n);
      }
    }
    if (y < h - 1) {
      const n = i + stride;
      if (!visited[n] && isBackdropAt(n)) {
        visited[n] = 1;
        stack.push(n);
      }
    }
  }

  ctx.putImageData(new ImageData(data, w, h), 0, 0);
  scene.textures.remove(textureKey);
  scene.textures.addCanvas(textureKey, canvas);
}

function keyOutAllPlayerSprites(scene) {
  keyOutRgbBackdrop(scene, "spr_player");
  for (let i = 0; i < PLAYER_RUN_FILES.length; i++) {
    keyOutRgbBackdrop(scene, `spr_player_run_${i}`);
  }
}

function keyOutAllHazardSprites(scene) {
  for (const { key } of HAZARD_FILES) {
    keyOutRgbBackdrop(scene, key);
  }
}

/**
 * Replace `tex_hud_dog` with the real idle sprite, fitted into a square icon so
 * the HUD matches the playable mascot without clipping ears, paws, or tail.
 */
function bakeHudDogFromPlayer(scene) {
  if (!scene.textures.exists("spr_player")) return false;

  const tex = scene.textures.get("spr_player");
  const img = tex.getSourceImage();
  if (!img) return false;

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return false;

  const scratch = document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
  scratchCtx.drawImage(img, 0, 0);

  const { data } = scratchCtx.getImageData(0, 0, w, h);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return false;

  const srcW = maxX - minX + 1;
  const srcH = maxY - minY + 1;

  const outSize = 64;
  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const padding = 4;
  const maxDraw = outSize - padding * 2;
  const scale = Math.min(maxDraw / srcW, maxDraw / srcH);
  const dw = Math.round(srcW * scale);
  const dh = Math.round(srcH * scale);
  const dx = Math.round((outSize - dw) / 2);
  const dy = Math.round((outSize - dh) / 2);
  ctx.drawImage(img, minX, minY, srcW, srcH, dx, dy, dw, dh);

  if (scene.textures.exists("tex_hud_dog")) {
    scene.textures.remove("tex_hud_dog");
  }
  scene.textures.addCanvas("tex_hud_dog", canvas);
  return true;
}

/**
 * All level backgrounds load from `assets/new_backgrounds/` only.
 * Keys `bg_1` … `bg_10` match source filenames (1).png … (10).png in order.
 */
const NEW_BACKGROUND_ROOMS = [
  { key: "bg_1", file: "ChatGPT Image May 4, 2026, 09_34_54 AM (1).png" },
  { key: "bg_2", file: "ChatGPT Image May 4, 2026, 09_34_54 AM (2).png" },
  { key: "bg_3", file: "ChatGPT Image May 4, 2026, 09_34_55 AM (3).png" },
  { key: "bg_4", file: "ChatGPT Image May 4, 2026, 09_34_55 AM (4).png" },
  { key: "bg_5", file: "ChatGPT Image May 4, 2026, 09_34_55 AM (5).png" },
  { key: "bg_6", file: "ChatGPT Image May 4, 2026, 09_34_56 AM (6).png" },
  { key: "bg_7", file: "ChatGPT Image May 4, 2026, 09_34_56 AM (7).png" },
  { key: "bg_8", file: "ChatGPT Image May 4, 2026, 09_34_56 AM (8).png" },
  { key: "bg_9", file: "ChatGPT Image May 4, 2026, 09_34_56 AM (9).png" },
  { key: "bg_10", file: "ChatGPT Image May 4, 2026, 09_34_56 AM (10).png" },
];

/*
 * All non-bitmap art is generated procedurally below.
 *
 * To swap in a real sprite asset later:
 *   1. Place the image under  assets/sprites/  or  assets/new_backgrounds/
 *   2. Load it in preload() with this.load.image / this.load.spritesheet
 *   3. Remove or skip the corresponding generateTexture block below
 */

function generatePlaceholderTextures(scene) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const need = (key) => !scene.textures.exists(key);

  /* ── Player (border-collie with teal vest) — skipped if spr_player loaded in preload ── */
  if (need("tex_player") && !scene.textures.exists("spr_player")) {
    g.clear();
    g.fillStyle(0x2a2a2a, 1);
    g.fillRoundedRect(6, 12, 36, 48, 10);
    g.fillStyle(0xf5e6c8, 1);
    g.fillRoundedRect(14, 16, 20, 20, 8);
    g.fillStyle(0x4a908a, 1);
    g.fillRoundedRect(12, 34, 24, 16, 5);
    g.fillStyle(0x3d7a75, 1);
    g.fillCircle(24, 42, 3);
    g.fillStyle(0x2a2a2a, 1);
    g.fillCircle(24, 14, 12);
    g.fillStyle(0xf5e6c8, 1);
    g.fillRect(21, 4, 6, 16);
    g.fillStyle(0x1a1a1a, 1);
    g.fillCircle(19, 12, 2);
    g.fillCircle(29, 12, 2);
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(18, 11, 0.8);
    g.fillCircle(28, 11, 0.8);
    g.fillStyle(0xcc5544, 1);
    g.fillCircle(24, 18, 2);
    g.fillStyle(0x2a2a2a, 1);
    g.fillEllipse(14, 6, 8, 6);
    g.fillEllipse(34, 6, 8, 6);
    g.fillStyle(0xf5e6c8, 1);
    g.fillRoundedRect(12, 56, 8, 14, 3);
    g.fillRoundedRect(28, 56, 8, 14, 3);
    g.fillStyle(0x2a2a2a, 1);
    g.fillEllipse(6, 18, 6, 10);
    g.lineStyle(2, 0x1a1a1a, 0.6);
    g.strokeRoundedRect(6, 12, 36, 48, 10);
    g.generateTexture("tex_player", 48, 72);
  }

  /* ── Doc collectible: golden page with star seal ── */
  if (need("tex_doc")) {
    g.clear();
    g.fillStyle(0xc9a227, 0.3);
    g.fillRoundedRect(4, 4, 30, 38, 4);
    g.fillStyle(0xffe066, 1);
    g.fillRoundedRect(1, 1, 30, 38, 4);
    g.fillStyle(0xffd740, 1);
    g.fillTriangle(21, 1, 31, 1, 31, 11);
    g.fillStyle(0xe6c84a, 1);
    g.fillTriangle(21, 1, 31, 11, 21, 11);
    g.lineStyle(2, 0xc9a227, 0.5);
    g.lineBetween(6, 14, 22, 14);
    g.lineBetween(6, 20, 20, 20);
    g.lineBetween(6, 26, 18, 26);
    g.fillStyle(0xffab00, 1);
    g.fillCircle(24, 30, 6);
    g.fillStyle(0xffe066, 1);
    g.fillCircle(24, 30, 3);
    g.lineStyle(2, 0x8d6e00, 0.8);
    g.strokeRoundedRect(1, 1, 30, 38, 4);
    g.generateTexture("tex_doc", 34, 42);
  }

  /* ── Floating wood platforms (horizontal planks, stretched in GameScene) ── */
  if (need("tex_wood_platform")) {
    const pw = 96;
    const ph = 22;
    g.clear();
    /* Terracotta plank face (#C76C4B) vs darker rust perimeter / grooves. */
    g.fillStyle(0x7a3828, 1);
    g.fillRect(0, 0, pw, ph);
    g.fillStyle(0xa85a44, 1);
    g.fillRect(0, 0, pw, ph - 4);
    g.fillStyle(0xc76c4b, 1);
    g.fillRect(2, 2, pw - 4, ph - 8);
    g.lineStyle(1, 0x9a4e3b, 0.85);
    for (let xi = 0; xi < pw; xi += 8) {
      g.lineBetween(xi + 0.5, 2, xi + 0.5, ph - 6);
    }
    g.lineStyle(2, 0x4e2a20, 1);
    g.strokeRect(1, 1, pw - 2, ph - 2);
    g.fillStyle(0x8b4534, 0.45);
    g.fillRect(0, ph - 5, pw, 4);
    g.generateTexture("tex_wood_platform", pw, ph);
  }

  /* ── Particle (small golden sparkle for collect effects) ── */
  if (need("tex_particle")) {
    g.clear();
    g.fillStyle(0xffe066, 1);
    g.fillCircle(4, 4, 4);
    g.fillStyle(0xffffff, 0.7);
    g.fillCircle(3, 3, 2);
    g.generateTexture("tex_particle", 8, 8);
  }

  /* ── Star particle (for fix effects) ── */
  if (need("tex_star_particle")) {
    g.clear();
    g.fillStyle(0x66bb6a, 1);
    g.fillCircle(5, 5, 5);
    g.fillStyle(0xa5d6a7, 0.7);
    g.fillCircle(4, 4, 2.5);
    g.generateTexture("tex_star_particle", 10, 10);
  }

  /* ── HUD dog icon (fallback if bakeHudDogFromPlayer does not run) ──
     Mascot head: charcoal + cream blaze, teal collar band, coral blush. */
  if (need("tex_hud_dog")) {
    const W = 36;
    const H = 34;
    const cx = W / 2;
    const fur = 0x2d2d2d;
    const outline = 0x1a1a1a;
    const cream = 0xf3ead8;
    const teal = 0x4a9b94;
    const tealHi = 0x5eb3ab;
    const tealDeep = 0x336b66;
    const blush = 0xf28b6c;

    g.clear();
    /* Ears (behind head) */
    g.fillStyle(fur, 1);
    g.fillEllipse(9, 10, 9, 12);
    g.fillEllipse(W - 9, 10, 9, 12);
    g.lineStyle(2, outline, 1);
    g.strokeEllipse(9, 10, 9, 12);
    g.strokeEllipse(W - 9, 10, 9, 12);

    /* Head */
    g.fillStyle(fur, 1);
    g.fillCircle(cx, 16, 12);
    g.lineStyle(2.5, outline, 1);
    g.strokeCircle(cx, 16, 12);

    /* Cream blaze */
    g.fillStyle(cream, 1);
    g.fillEllipse(cx, 9.5, 7, 9);
    g.fillEllipse(cx, 17, 9, 10);

    /* Collar + harness badge */
    g.fillStyle(tealDeep, 1);
    g.fillEllipse(cx, 27, 20, 7);
    g.fillStyle(teal, 1);
    g.fillEllipse(cx, 26, 16, 5);
    g.fillStyle(tealHi, 1);
    g.fillCircle(cx, 25.75, 3);
    g.fillStyle(tealDeep, 1);
    g.fillCircle(cx, 25.75, 1.8);

    /* Eyes */
    g.fillStyle(0x141414, 1);
    g.fillCircle(12.5, 15, 2.5);
    g.fillCircle(23.5, 15, 2.5);
    g.fillStyle(0xffffff, 0.95);
    g.fillCircle(11.6, 14.1, 0.9);
    g.fillCircle(22.6, 14.1, 0.9);

    /* Blush */
    g.fillStyle(blush, 1);
    g.fillCircle(8.6, 18, 1.85);
    g.fillCircle(W - 8.6, 18, 1.85);

    /* Nose */
    g.fillStyle(0x101010, 1);
    g.fillEllipse(cx, 20.5, 4.2, 3);
    g.fillStyle(0xf5f5f5, 0.88);
    g.fillEllipse(cx - 0.6, 19.5, 1.3, 1);

    g.generateTexture("tex_hud_dog", W, H);
  }

  /* ── HUD doc icon ── */
  if (need("tex_hud_doc")) {
    g.clear();
    g.fillStyle(0xffe066, 1);
    g.fillRoundedRect(1, 1, 16, 20, 2);
    g.lineStyle(1.5, 0x8d6e00, 0.7);
    g.strokeRoundedRect(1, 1, 16, 20, 2);
    g.lineStyle(1, 0xc9a227, 0.5);
    g.lineBetween(4, 7, 14, 7);
    g.lineBetween(4, 11, 12, 11);
    g.fillStyle(0xffab00, 1);
    g.fillCircle(13, 16, 3);
    g.fillStyle(0xffe066, 1);
    g.fillCircle(13, 16, 1.6);
    g.lineStyle(2, 0x8d6e00, 0.85);
    g.strokeRoundedRect(1, 1, 16, 20, 2);
    g.generateTexture("tex_hud_doc", 20, 24);
  }

  g.destroy();
}

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload() {
    /* Mobile cellular needs ~14MB of art before play; surface real progress so the
       loading overlay never feels frozen, and so anyone watching can tell the
       request is still alive. The DOM overlay listens for these events. */
    this.load.on("progress", (value) => {
      globalThis.dispatchEvent(
        new CustomEvent("opsy:load-progress", { detail: { progress: value } })
      );
    });
    this.load.on("complete", () => {
      globalThis.dispatchEvent(
        new CustomEvent("opsy:load-progress", { detail: { progress: 1 } })
      );
    });

    this.load.image("spr_player", playerAssetHref(PLAYER_IDLE_FILE));
    this.load.image("tex_hud_dog", uiAssetHref(HUD_DOG_FILE));
    this.load.image("tex_opsy_end", opsyEndAssetHref(OPSY_END_FILE));
    for (let i = 0; i < PLAYER_RUN_FILES.length; i++) {
      this.load.image(`spr_player_run_${i}`, playerAssetHref(PLAYER_RUN_FILES[i]));
    }
    for (const { key, file } of HAZARD_FILES) {
      this.load.image(key, hazardAssetHref(file));
    }

    for (const { key, file } of NEW_BACKGROUND_ROOMS) {
      /* `?v=` busts the browser cache when the PNGs are re-aligned by
         scripts/align_background_floors.py — bump when the files change. */
      this.load.image(
        key,
        new URL(`../assets/new_backgrounds/${file}?v=2`, import.meta.url).href
      );
    }
  }

  create() {
    const runTexturesReady = PLAYER_RUN_FILES.every((_, i) =>
      this.textures.exists(`spr_player_run_${i}`)
    );
    const playerReady =
      this.textures.exists("spr_player") && runTexturesReady;
    const dedicatedHudDogReady = this.textures.exists("tex_hud_dog");

    if (playerReady) {
      keyOutAllPlayerSprites(this);
    }
    keyOutAllHazardSprites(this);

    generatePlaceholderTextures(this);

    if (playerReady && !dedicatedHudDogReady) {
      bakeHudDogFromPlayer(this);
    }

    if (!playerReady) {
      console.error(
        "[BootScene] Player PNGs missing — check src/assets/opsy_running_new/ and the preload URLs in the network tab."
      );
    } else if (!this.anims.exists("player_run")) {
      /* Eight run frames: slightly higher base fps than the old 7-frame strip so
         the gait reads smoother while GameScene still scales speed with run velocity. */
      this.anims.create({
        key: "player_run",
        frames: PLAYER_RUN_FILES.map((_, i) => ({ key: `spr_player_run_${i}` })),
        frameRate: 14,
        repeat: -1,
      });
      this.anims.create({
        key: "player_idle",
        frames: [{ key: "spr_player" }],
        frameRate: 8,
        repeat: -1,
      });
      this.anims.create({
        key: "player_jump",
        frames: [{ key: "spr_player" }],
        frameRate: 8,
        repeat: -1,
      });
    }

    globalThis.dispatchEvent(new CustomEvent("opsy:game-ready"));
    this.scene.start("StartScene");
  }
}
