import { submitScore } from "../api.js";

const Phaser = globalThis.Phaser;
if (!Phaser) {
  throw new Error("Phaser not loaded — check script order in index.html.");
}

/* ═══════════════════════════════════════════════════════════════
 *  LEVEL DATA
 *
 *  The world is a single horizontally-scrolling level whose vertical
 *  extent matches the viewport (540 px). The dog auto-runs right and
 *  collects floating doc pickups for score.
 *
 *  Backgrounds in `assets/new_backgrounds/` (1672×941 PNGs) are the
 *  ONLY thing painted into the world — every zone is sized to one
 *  full background image, drawn at uniform scale so the art appears
 *  in full with no cropping and no horizontal squash. Aside from small
 *  floating wood platforms (optional gameplay), no procedural wall/ground/sky
 *  is layered on the art. The main walkable surface is whatever the
 *  background depicts; the floor collider is invisible.
 * ═══════════════════════════════════════════════════════════════ */

const FLOOR_TOP = 460; /* y-coordinate of the walkable surface */
const FLOOR_H = 80;
const WORLD_HEIGHT = 540;

/* Source backgrounds are 1672×941. Uniform-scaled to fill WORLD_HEIGHT,
   each image is exactly this many world pixels wide. ZONE_W matches that
   so adjacent rooms tile without overlap (which used to crop the art). */
const ROOM_IMG_W = 1672;
const ROOM_IMG_H = 941;
const ZONE_W = Math.round(ROOM_IMG_W * (WORLD_HEIGHT / ROOM_IMG_H));

const ZONE_DEFS = [
  { key: "yard", label: "FRONT YARD", bg: "bg_1", kind: "outdoor" },
  { key: "kitchen1", label: "KITCHEN", bg: "bg_2", kind: "indoor" },
  { key: "kitchen2", label: "KITCHEN+", bg: "bg_3", kind: "indoor" },
  { key: "laundry", label: "LAUNDRY", bg: "bg_4", kind: "indoor" },
  { key: "gym", label: "GYM", bg: "bg_5", kind: "indoor" },
  { key: "dining", label: "DINING", bg: "bg_6", kind: "indoor" },
  { key: "living", label: "LIVING", bg: "bg_7", kind: "indoor" },
  { key: "media", label: "MEDIA", bg: "bg_8", kind: "indoor" },
  { key: "bath", label: "BATH", bg: "bg_9", kind: "indoor" },
  { key: "bedroom", label: "BEDROOM", bg: "bg_10", kind: "indoor" },
  { key: "kids", label: "KIDS", bg: "bg_1", kind: "indoor" },
  { key: "office", label: "OFFICE", bg: "bg_2", kind: "indoor" },
  { key: "basement", label: "BASEMENT", bg: "bg_3", kind: "indoor" },
  { key: "garage", label: "GARAGE", bg: "bg_4", kind: "indoor" },
  { key: "garden", label: "BACK YARD", bg: "bg_5", kind: "outdoor" },
];

const ZONES = ZONE_DEFS.map((def, i) => ({ ...def, x: i * ZONE_W, w: ZONE_W }));
const WORLD_WIDTH = ZONE_W * ZONE_DEFS.length;

/* Doc collectibles, expressed as offsets from each zone's left edge. All y
   values stay within a single jump's apex (~160 px above FLOOR_TOP) so every
   doc is reachable from the painted floor without needing a platform under it. */
const ZONE_DOCS = [
  /* yard       */[{ dx: 240, y: 360 }, { dx: 500, y: 320 }, { dx: 760, y: 290 }],
  /* kitchen1   */[{ dx: 220, y: 320 }, { dx: 480, y: 290 }, { dx: 740, y: 360 }],
  /* kitchen2   */[{ dx: 260, y: 290 }, { dx: 520, y: 360 }, { dx: 780, y: 320 }],
  /* laundry    */[{ dx: 240, y: 360 }, { dx: 500, y: 320 }, { dx: 760, y: 290 }],
  /* gym        */[{ dx: 220, y: 320 }, { dx: 480, y: 290 }, { dx: 740, y: 360 }],
  /* dining     */[{ dx: 260, y: 290 }, { dx: 520, y: 360 }, { dx: 780, y: 320 }],
  /* living     */[{ dx: 240, y: 360 }, { dx: 500, y: 320 }, { dx: 760, y: 290 }],
  /* media      */[{ dx: 220, y: 320 }, { dx: 480, y: 290 }, { dx: 740, y: 360 }],
  /* bath       */[{ dx: 260, y: 290 }, { dx: 520, y: 360 }, { dx: 780, y: 320 }],
  /* bedroom    */[{ dx: 240, y: 360 }, { dx: 500, y: 320 }, { dx: 760, y: 290 }],
  /* kids       */[{ dx: 220, y: 320 }, { dx: 480, y: 290 }, { dx: 740, y: 360 }],
  /* office     */[{ dx: 260, y: 290 }, { dx: 520, y: 360 }, { dx: 780, y: 320 }],
  /* basement   */[{ dx: 240, y: 360 }, { dx: 500, y: 320 }, { dx: 760, y: 290 }],
  /* garage     */[{ dx: 220, y: 320 }, { dx: 480, y: 290 }, { dx: 740, y: 360 }],
  /* garden     */[{ dx: 260, y: 290 }, { dx: 520, y: 360 }, { dx: 780, y: 320 }],
];

const DOCS = ZONE_DOCS.flatMap((list, i) =>
  list.map((d) => ({ x: i * ZONE_W + d.dx, y: d.y }))
);

const PLATFORM_THICKNESS = 22;
const MAX_LAYOUT_LAP_BONUS = 4;

/* Each PNG is a square (~1024×1024) with the actual hazard art centered and
   transparent padding around it. `bottomFrac` is where the *visible* bottom of
   the art sits inside the image (0 = top, 1 = bottom of the PNG). We anchor on
   this point so the asset plants firmly on the painted floor instead of
   floating above it on its lower padding strip. Tuned by eye against the source
   PNGs in `assets/hazards_new/`. */
const HAZARD_TYPES = {
  /* Free-standing broken pipe with a water pool at the base. The pool reaches
     close to the bottom of the PNG. */
  pipe: { tex: "hazard_pipe_leak", size: 155, bodyW: 48, bodyH: 76, bottomFrac: 0.88 },
  /* Boxy furnace with little legs and a small ground shadow. */
  furnace: { tex: "hazard_furnace", size: 165, bodyW: 72, bodyH: 88, bottomFrac: 0.84 },
  /* Fallen gutter lying in muddy water — wide art, leaves a generous puddle
     under it that tapers toward the PNG bottom. */
  gutter: { tex: "hazard_gutter", size: 190, bodyW: 118, bodyH: 50, bottomFrac: 0.80 },
  /* Floor vent set into a brick frame with steam rising up. The brick frame is
     fairly low in the PNG. */
  vent: { tex: "hazard_vent", size: 150, bodyW: 86, bodyH: 52, bottomFrac: 0.82 },
  /* Broken floorboards lying flat. Most of the PNG above the boards is empty
     because the boards are short — anchor lower. */
  floorboards: { tex: "hazard_floorboards", size: 178, bodyW: 112, bodyH: 42, bottomFrac: 0.74 },
  /* Tall water heater with a leak puddle at the base. */
  boiler: { tex: "hazard_boiler", size: 172, bodyW: 74, bodyH: 94, bottomFrac: 0.85 },
  /* Sparking electrical box: narrow but tall, with sparks extending outward. */
  breaker: { tex: "hazard_breaker", size: 160, bodyW: 62, bodyH: 92, bottomFrac: 0.85 },
  /* Overflowing toilet: wide puddle gives it a meaningful ground footprint. */
  toilet: { tex: "hazard_toilet", size: 170, bodyW: 112, bodyH: 82, bottomFrac: 0.80 },
  /* Broken mini stair / step: broad, low obstacle. */
  brokenStairs: { tex: "hazard_broken_stairs", size: 172, bodyW: 128, bodyH: 58, bottomFrac: 0.74 },
  /* Broken window: contact is mostly the glass pile along the floor. */
  brokenWindow: { tex: "hazard_broken_window", size: 168, bodyW: 136, bodyH: 44, bottomFrac: 0.79 },
  /* Ceiling leak includes both the overhead crack and floor puddle in one PNG. */
  ceilingLeak: { tex: "hazard_ceiling_leak", size: 184, bodyW: 118, bodyH: 50, bottomFrac: 0.86 },
};

/* Intro safety + fairness rules for hazard stream:
   - Keep the first stretch hazard-free so players ease into controls.
   - Enforce minimum spacing between hazards so jumps are always readable.
   - Prevent identical hazard types from appearing back-to-back. */
const HAZARD_SAFE_START_X = ZONE_W + 140;
const MIN_HAZARD_GAP_PX = 350;

function createLayoutRng(zoneIndex, lap, salt = 0) {
  let state = ((zoneIndex + 1) * 0x9e3779b1) ^ ((lap + 11) * 0x85ebca6b) ^ salt;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function platformCountForZone(zoneIndex, lap) {
  if (zoneIndex === 0) return 1;
  const lapBonus = Math.min(lap, MAX_LAYOUT_LAP_BONUS);
  if (zoneIndex >= 8 && (zoneIndex + lapBonus) % 3 === 0) return 3;
  return 2;
}

function platformLaneFractions(count, zoneIndex, lap) {
  if (count === 1) return [0.54 + (((zoneIndex + lap) % 3) - 1) * 0.06];
  if (count === 2) {
    return (zoneIndex + lap) % 2 === 0 ? [0.30, 0.72] : [0.36, 0.80];
  }
  return [0.22, 0.52, 0.82];
}

function buildPlatformsForLap(lap = 0) {
  const lapBonus = Math.min(lap, MAX_LAYOUT_LAP_BONUS);
  return ZONES.flatMap((zone, zoneIndex) => {
    const rand = createLayoutRng(zoneIndex, lapBonus, 0x51f15e);
    const difficulty = zoneIndex / Math.max(ZONES.length - 1, 1);
    const count = platformCountForZone(zoneIndex, lapBonus);

    return platformLaneFractions(count, zoneIndex, lapBonus).map((frac, laneIndex) => {
      const laneJitter = Math.round((rand() - 0.5) * 72);
      const x = zone.x + Phaser.Math.Clamp(Math.round(ZONE_W * frac) + laneJitter, 180, ZONE_W - 130);
      const yJitter = Math.round((rand() - 0.5) * 22);
      const y = Phaser.Math.Clamp(
        Math.round(346 - difficulty * 28 - lapBonus * 4 + yJitter + laneIndex * 4),
        306,
        348
      );
      const w = Math.round(126 + rand() * 34 + difficulty * 18);
      return { x, y, w };
    });
  });
}

function hazardPoolForZone(zone) {
  if (zone.key === "garden") {
    return ["gutter", "pipe", "floorboards", "brokenStairs"];
  }
  if (zone.key === "yard") {
    return ["floorboards", "pipe", "breaker", "brokenStairs"];
  }
  if (["laundry", "basement", "garage"].includes(zone.key)) {
    return ["boiler", "furnace", "pipe", "breaker", "floorboards"];
  }
  if (["bath", "kids"].includes(zone.key)) {
    return ["toilet", "pipe", "vent", "floorboards", "brokenStairs"];
  }
  return ["pipe", "vent", "floorboards", "breaker", "brokenStairs"];
}

function hazardCountForZone(zoneIndex, lap) {
  if (zoneIndex === 0) return 0;
  const lapBonus = Math.min(lap, MAX_LAYOUT_LAP_BONUS);
  if (zoneIndex < 4) return 1;
  if (zoneIndex < 10) return lapBonus >= 3 && zoneIndex % 3 === 0 ? 3 : 2;
  return lapBonus >= 1 ? 3 : 2;
}

function pickHazardType(pool, rand, previousType, zoneIndex, lap, laneIndex) {
  if (!pool.length) return undefined;
  let idx = Math.floor(rand() * pool.length + zoneIndex + lap + laneIndex) % pool.length;
  if (pool[idx] === previousType && pool.length > 1) {
    idx = (idx + 1 + laneIndex) % pool.length;
  }
  return pool[idx];
}

function buildHazardsForLap(lap = 0, platforms = buildPlatformsForLap(lap)) {
  const raw = [];
  let previousType;

  for (let zoneIndex = 0; zoneIndex < ZONES.length; zoneIndex++) {
    const zone = ZONES[zoneIndex];
    const rand = createLayoutRng(zoneIndex, Math.min(lap, MAX_LAYOUT_LAP_BONUS), 0xba5eba11);
    const zonePlatforms = platforms.filter((p) => p.x >= zone.x && p.x < zone.x + zone.w);
    const count = Math.min(hazardCountForZone(zoneIndex, lap), Math.max(zonePlatforms.length, 1));
    const pool = hazardPoolForZone(zone);

    for (let laneIndex = 0; laneIndex < count; laneIndex++) {
      const lane = zonePlatforms[laneIndex % zonePlatforms.length];
      const laneDx = lane ? lane.x - zone.x : ZONE_W * (0.35 + laneIndex * 0.3);
      const jitter = Math.round((rand() - 0.5) * 84);
      const dx = Phaser.Math.Clamp(Math.round(laneDx + jitter), 170, ZONE_W - 120);
      const type = pickHazardType(pool, rand, previousType, zoneIndex, lap, laneIndex);
      if (!type) continue;
      previousType = type;
      raw.push({ x: zone.x + dx, type });
    }
  }

  raw.sort((a, b) => a.x - b.x);

  const accepted = [];
  for (const hazard of raw) {
    if (hazard.x < HAZARD_SAFE_START_X) continue;

    const prev = accepted[accepted.length - 1];
    if (!prev) {
      accepted.push(hazard);
      continue;
    }

    const gap = hazard.x - prev.x;
    if (gap < MIN_HAZARD_GAP_PX) continue;
    if (hazard.type === prev.type) continue;
    accepted.push(hazard);
  }
  return accepted;
}

const LEVEL = {
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,

  startLives: 3,
  scorePerDoc: 10,
  /* Invulnerability window (reserved for future hazard hits). */
  invulnMs: 3200,
  playerSpawn: { x: 90, y: FLOOR_TOP - 20 },

  /* Auto-run: slow start, then progressive acceleration up to maxRunSpeed.
     After a wrap, getRunSpeed locks in the speed the player ended the lap at. */
  baseRunSpeed: 160,
  maxRunSpeed: 460,
  /* Reach max speed near the end of the lap (≈ 81% of the way through). */
  speedRampAtX: Math.round(WORLD_WIDTH * 0.81),

  /* Per-loop tiny speed bump so successive loops trend slightly faster
     (capped at maxRunSpeed by getRunSpeed). */
  loopSpeedBoost: 12,

  /* Wrap a touch before the right wall so the player never bumps it mid-jump. */
  wrapTriggerX: WORLD_WIDTH - 80,

  /* Physics tuning — apex ≈ 620²/(2·1200) ≈ 160 px above the floor, so any
     doc within ~160 px above FLOOR_TOP can be grabbed mid-jump. */
  jumpVelocity: -620,
  coyoteMs: 90,
  jumpBufferMs: 90,

  zones: ZONES,
  docs: DOCS,
};

const TEX = {
  player: "spr_player",
  doc: "tex_doc",
  woodPlatform: "tex_wood_platform",
  hudDog: "tex_hud_dog",
  hudDoc: "tex_hud_doc",
  particle: "tex_particle",
  opsyEnd: "tex_opsy_end",
};

/**
 * Loads that 404 or error out can still leave a key registered; using those
 * textures then crashes inside Phaser (e.g. reading `undefined.size` on frames).
 *
 * @param {Phaser.Scene} scene
 * @param {string} key
 * @returns {Phaser.Textures.Frame | null}
 */
function safeTextureFrame(scene, key) {
  try {
    if (!scene?.textures?.exists(key)) return null;
    const tex = scene.textures.get(key);
    if (!tex || typeof tex.get !== "function") return null;
    const fr = tex.get();
    const w =
      typeof fr.width === "number"
        ? fr.width
        : typeof fr.cutWidth === "number"
          ? fr.cutWidth
          : NaN;
    const h =
      typeof fr.height === "number"
        ? fr.height
        : typeof fr.cutHeight === "number"
          ? fr.cutHeight
          : NaN;
    if ((!Number.isFinite(w) || w <= 0) && (!Number.isFinite(h) || h <= 0)) {
      return null;
    }
    return fr;
  } catch {
    return null;
  }
}

/** Warm wash opacity; tune via `--background-overlay-opacity` on `:root` in style.css */
const BG_OVERLAY_RGB = 0xf5ebdc;

function readBackgroundOverlayOpacity() {
  if (typeof document === "undefined") return 0.18;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--background-overlay-opacity")
    .trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? Phaser.Math.Clamp(n, 0, 1) : 0.18;
}

/* ═══════════════════════════════════════════════════════════════
 *  GAME SCENE
 * ═══════════════════════════════════════════════════════════════ */

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
  }

  /**
   * Phaser's `scene.restart()` keeps the same Scene JS instance but tears down
   * every GameObject/Group/Tween it created. Properties like `this.hazardGroup`
   * therefore still point at *destroyed* objects on the second `create()` call,
   * and reaching into them blows up deep inside Phaser (e.g. "Cannot read
   * properties of undefined (reading 'size')" on a stale physics group).
   *
   * `init()` runs at the start of every (re)start, before `create()`, so we use
   * it to drop those references and force the build* helpers to allocate fresh.
   */
  init() {
    this.player = undefined;
    this.floor = undefined;
    this.platformGroup = undefined;
    this.currentPlatforms = undefined;
    this.docGroup = undefined;
    this.docGlows = undefined;
    this.hazardGroup = undefined;
    this.hazardVisuals = undefined;
    this.collectEmitter = undefined;
    this.overlay = undefined;
    this.cursors = undefined;
    this.keys = undefined;
    this.spaceKey = undefined;
    this.overlayTapRestart = undefined;
    this.isGameOver = false;
    this.hasWon = false;
    this.isJumping = false;
    this.hudBottomY = 0;
  }

  /* ────────────────── create ────────────────── */

  create() {
    /* Scoreboard stays in the DOM for a11y/SEO but hides until game over fires `opsy:scores-updated`. */
    const leaderboardPanel =
      typeof document !== "undefined"
        ? document.getElementById("leaderboard-panel")
        : null;
    if (leaderboardPanel) leaderboardPanel.hidden = true;

    this.physics.world.setBounds(0, 0, LEVEL.worldWidth, LEVEL.worldHeight);

    this.isTouch = this.sys.game.device.input.touch;
    if (this.isTouch) this.input.addPointer(2);

    /* State */
    this.lives = LEVEL.startLives;
    this.score = 0;
    this.docsCollected = 0;
    this.loopCount = 0;
    /* Lower-bound on auto-run speed. Starts at base; on each wrap we promote
       the speed the player ended the lap at (plus a small per-loop bump),
       so subsequent loops keep the late-game pace instead of starting slow. */
    this.speedFloor = LEVEL.baseRunSpeed;
    this.isGameOver = false;
    /* Kept for compatibility with the overlay code (which checks both
       `hasWon` and `isGameOver`); the win-on-docs path is intentionally
       disabled in infinite mode. */
    this.hasWon = false;
    this.invulnerableUntil = 0;

    /* Coyote / jump buffer */
    this.coyoteCounter = 0;
    this.jumpBufferCounter = 0;
    this.isJumping = false;

    /* Touch: tap playfield to jump; Y above this is the fixed HUD strip (see buildHud). */
    this.hudBottomY = 0;
    this.jumpInputUnlockAt = this.time.now + (this.isTouch ? 500 : 0);

    /* Build everything */
    this.drawZoneBackgrounds();
    this.addBackgroundOverlay();
    this.drawZoneLabels();
    this.buildFloor();
    this.buildPlatforms();

    const playerKey = this.textures.exists("spr_player")
      ? "spr_player"
      : "tex_player";
    this.player = this.physics.add.sprite(
      LEVEL.playerSpawn.x,
      LEVEL.playerSpawn.y,
      playerKey,
      0
    );
    if (playerKey === "spr_player") {
      /* Square PNGs from `opsy_running_new` (1254×1254). Base scale matches the
         old ~230px-wide strip at 0.4, with a modest bump so the dog reads larger
         on screen. Origin at bottom-centre keeps feet on the floor. Body size
         / offset are scaled from the prior 230×174 sheet. */
      const srcPx = 1254;
      const oldW = 230;
      const r = srcPx / oldW;
      const displayBoost = 1.3;
      this.player.setOrigin(0.5, 1);
      this.player.setScale(0.4 * (oldW / srcPx) * displayBoost);
      this.player.body.setSize(Math.round(99 * r), Math.round(75 * r));
      this.player.body.setOffset(Math.round(65 * r), Math.round(99 * r));
      this.player.refreshBody();
    } else {
      /* Procedural tex_player is 48×72 */
      this.player.setOrigin(0.5, 0.5);
      this.player.setScale(1);
      this.player.body.setSize(30, 50);
      this.player.body.setOffset(9, 18);
    }
    this.player.setCollideWorldBounds(true);
    this.player.setBounce(0.05);
    this.player.setMaxVelocity(700, 1000);
    this.player.setDepth(20);

    this.docGroup = this.physics.add.group();
    this.buildDocs();
    this.buildHazards();

    this.physics.add.collider(this.player, this.floor);
    if (this.platformGroup) {
      this.physics.add.collider(this.player, this.platformGroup);
    }
    this.physics.add.overlap(this.player, this.docGroup, (_, doc) =>
      this.collectDoc(doc)
    );
    if (this.hazardGroup) {
      this.physics.add.overlap(this.player, this.hazardGroup, () =>
        this.hitHazard()
      );
    }

    /* Keyboard */
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      w: Phaser.Input.Keyboard.KeyCodes.W,
      r: Phaser.Input.Keyboard.KeyCodes.R,
    });
    this.spaceKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );

    /* Camera — horizontal-only follow since the world height matches the viewport. */
    this.cameras.main.setBounds(0, 0, LEVEL.worldWidth, LEVEL.worldHeight);
    this.cameras.main.startFollow(this.player, true, 0.12, 0, 0, 0);
    this.cameras.main.setDeadzone(120, 9999);
    this.cameras.main.setRoundPixels(true);

    /* Particles (skip if collectible particle texture failed to bake). */
    if (safeTextureFrame(this, TEX.particle)) {
      this.collectEmitter = this.add.particles(0, 0, TEX.particle, {
        speed: { min: 40, max: 140 },
        scale: { start: 1, end: 0 },
        lifespan: 500,
        quantity: 8,
        emitting: false,
        gravityY: -60,
      });
      this.collectEmitter.setDepth(50);
    } else {
      this.collectEmitter = null;
    }

    /* HUD & Overlay */
    this.buildHud();
    this.buildOverlay();
    this.updateHud();

    /* One-line mobile hint (tap anywhere below HUD = jump) */
    if (this.isTouch) {
      this.buildMobileJumpHint();
    }

    this._restartFromLeaderboardDom = () => {
      if (this.isGameOver || this.hasWon) this.scene.restart();
    };
    globalThis.addEventListener("opsy:restart-game", this._restartFromLeaderboardDom);
  }

  shutdown() {
    if (this._restartFromLeaderboardDom) {
      globalThis.removeEventListener("opsy:restart-game", this._restartFromLeaderboardDom);
      this._restartFromLeaderboardDom = undefined;
    }
  }

  /* ────────────────── Zone backgrounds ────────────────── */

  drawZoneBackgrounds() {
    /*
     * Each room PNG is the only thing painted into the world. No wall, ground,
     * or sky overlays are drawn so the original art shows in full.
     *
     * Image is anchored at the zone's left edge and scaled uniformly so its
     * height fills the viewport — its displayed width then exactly matches
     * ZONE_W (rooms tile seamlessly with no overlap and no cropping).
     */
    for (const z of LEVEL.zones) {
      const frame = safeTextureFrame(this, z.bg);
      if (!frame) continue;
      const im = this.add.image(z.x, 0, z.bg);
      im.setOrigin(0, 0);
      const srcH = frame.height || frame.cutHeight || 1;
      im.setScale(LEVEL.worldHeight / srcH);
      /* +1 px wide: avoids a one-pixel gap when ZONE_W is rounded vs scaled texture width and filtering samples the canvas clear color. */
      im.setDisplaySize(im.displayWidth + 1, LEVEL.worldHeight);
      im.setDepth(-20);
    }
  }

  /**
   * Subtle warm rectangle over background art only (single canvas: not over dog,
   * pickups, platforms, or HUD). Depth sits above bg images (-20) and below
   * zone labels (-1) and all gameplay.
   */
  addBackgroundOverlay() {
    const a = readBackgroundOverlayOpacity();
    if (a <= 0) return;
    this.add
      .rectangle(
        LEVEL.worldWidth / 2,
        LEVEL.worldHeight / 2,
        LEVEL.worldWidth,
        LEVEL.worldHeight,
        BG_OVERLAY_RGB,
        a
      )
      .setDepth(-10);
  }

  /* ────────────────── Zone labels ────────────────── */

  drawZoneLabels() {
    for (const z of LEVEL.zones) {
      this.add
        .text(z.x + 12, 10, z.label, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          color: "#3e2723",
          backgroundColor: "rgba(255,248,238,0.85)",
          padding: { x: 6, y: 3 },
          fontStyle: "700",
        })
        .setDepth(-1);
    }
  }

  /* ────────────────── Floor collider ────────────────── */

  buildFloor() {
    /*
     * The walkable surface is whatever each background paints at FLOOR_TOP.
     * We give the player one transparent static collider that spans the full
     * world width so the dog stays planted on the painted floor without any
     * additional ground / platform shape rendered on top of the original art.
     */
    const floor = this.add.rectangle(
      LEVEL.worldWidth / 2,
      FLOOR_TOP + FLOOR_H / 2,
      LEVEL.worldWidth,
      FLOOR_H,
      0x000000,
      0
    );
    this.physics.add.existing(floor, true);
    this.floor = floor;
  }

  /* ────────────────── Floating wood platforms ────────────────── */

  buildPlatforms() {
    this.currentPlatforms = buildPlatformsForLap(this.loopCount);
    if (!safeTextureFrame(this, TEX.woodPlatform) || !this.currentPlatforms.length) {
      if (this.platformGroup) this.platformGroup.clear(true, true);
      return;
    }

    const group = this.platformGroup || this.physics.add.staticGroup();
    group.clear(true, true);
    for (const p of this.currentPlatforms) {
      const plat = group.create(p.x, p.y, TEX.woodPlatform);
      plat.setOrigin(0.5, 0);
      plat.setDisplaySize(p.w, PLATFORM_THICKNESS);
      plat.refreshBody();
      plat.setDepth(8);
    }
    this.platformGroup = group;
  }

  /* ────────────────── Build docs ────────────────── */

  buildDocs() {
    /* Glows are tracked separately because they aren't physics bodies — we
       destroy them on wrap so successive laps don't stack identical glow
       graphics on top of each other. Any stale entries left over from a
       destroyed scene are skipped (`destroy()` on an already-destroyed
       Graphics throws inside Phaser). */
    if (!Array.isArray(this.docGlows)) this.docGlows = [];
    for (const g of this.docGlows) {
      if (g && g.scene && typeof g.destroy === "function") {
        try { g.destroy(); } catch { /* already torn down */ }
      }
    }
    this.docGlows.length = 0;

    if (!safeTextureFrame(this, TEX.doc)) return;

    for (const d of LEVEL.docs) {
      const sprite = this.docGroup.create(d.x, d.y, TEX.doc);
      sprite.setImmovable(true);
      sprite.body.setAllowGravity(false);
      sprite.setCircle(14, 3, 7);
      sprite.setDepth(5);
      sprite.setScale(1.1);

      this.tweens.add({
        targets: sprite,
        y: d.y - 6,
        duration: 1200 + (d.x * 7) % 400,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });

      const glow = this.add.graphics();
      glow.fillStyle(0xffe066, 0.15);
      glow.fillEllipse(d.x, d.y + 16, 28, 8);
      glow.setDepth(4);
      this.docGlows.push(glow);
    }
  }

  /* ────────────────── Build hazards ────────────────── */

  buildHazards() {
    if (!Array.isArray(this.hazardVisuals)) this.hazardVisuals = [];
    for (const visual of this.hazardVisuals) {
      if (visual && visual.scene && typeof visual.destroy === "function") {
        try { visual.destroy(); } catch { /* already torn down */ }
      }
    }
    this.hazardVisuals.length = 0;

    const hazards = buildHazardsForLap(this.loopCount, this.currentPlatforms);
    /* `init()` clears `this.hazardGroup` between scene restarts so we always
       start with a fresh static group; reusing a destroyed one is what was
       crashing Phaser ("reading 'size'" on a dead body). */
    const reusable =
      this.hazardGroup &&
      this.hazardGroup.scene &&
      typeof this.hazardGroup.clear === "function";
    const group = reusable ? this.hazardGroup : this.physics.add.staticGroup();
    if (reusable) {
      try {
        group.clear(true, true);
      } catch {
        /* if the underlying group was disposed mid-flight, fall back to a new one */
        this.hazardGroup = undefined;
        return this.buildHazards();
      }
    }
    if (!hazards.length) {
      this.hazardGroup = group;
      return;
    }

    for (const h of hazards) {
      const type = HAZARD_TYPES[h.type];
      if (!type || !safeTextureFrame(this, type.tex)) continue;

      /* Slight bury so the visible bottom of the art (water pool / shadow / brick)
         tucks into the painted floor rather than perching on top of it. */
      const bottomY = FLOOR_TOP + 6;

      /* Anchor on the visible bottom of the hazard art (not the bottom of the
         square PNG, which is mostly transparent padding). This is what
         eliminates the "floating above the floor" look. */
      const anchorY = type.bottomFrac ?? 1;
      const image = this.add
        .image(h.x, bottomY, type.tex)
        .setOrigin(0.5, anchorY)
        .setDisplaySize(type.size, type.size)
        .setDepth(9);
      this.hazardVisuals.push(image);

      /* Soft contact shadow keeps the object visually grounded even on
         backgrounds whose floor tone happens to match the asset. */
      const shadowW = Math.round(type.bodyW * 1.35);
      const shadow = this.add
        .ellipse(h.x, bottomY + 2, shadowW, 10, 0x000000, 0.18)
        .setDepth(8);
      this.hazardVisuals.push(shadow);

      const hitbox = this.add.rectangle(
        h.x,
        bottomY - type.bodyH / 2,
        type.bodyW,
        type.bodyH,
        0xff0000,
        0
      );
      this.physics.add.existing(hitbox, true);
      group.add(hitbox);
    }

    this.hazardGroup = group;
  }

  /* ────────────────── HUD ────────────────── */

  buildHud() {
    const W = this.scale.width;
    const barY = 8;
    /** Taller bar: top row is session chrome, bottom row matches former single-row HUD layout. */
    const barH = 54;

    this.hudRaiseable = [];
    const trackHud = (obj) => {
      if (obj) this.hudRaiseable.push(obj);
      return obj;
    };

    this.hudBottomY = barY + barH + 6;

    this.hudBar = trackHud(
      this.add
        .rectangle(W / 2, barY + barH / 2, W - 16, barH, 0xf4e8d4, 0.92)
        .setStrokeStyle(2.5, 0x5c3d2e)
        .setScrollFactor(0)
        .setDepth(100)
    );

    const player = this.registry.get("player");
    let sessionStr = "";
    if (player && player.username) {
      const nm = player.name ? String(player.name).trim().slice(0, 26) : "";
      sessionStr =
        nm.length > 0 ? `Playing as @${player.username} · ${nm}` : `Playing as @${player.username}`;
    } else {
      sessionStr = "Playing as guest";
    }
    const sessionMax = Math.max(18, Math.floor((W - 220) / 6.8));
    if (sessionStr.length > sessionMax) {
      sessionStr = `${sessionStr.slice(0, sessionMax - 1)}\u2026`;
    }

    const sessionTint = "#5c3d2e";
    trackHud(
      this.add
        .text(26, barY + 10, sessionStr, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          color: sessionTint,
          fontStyle: "600",
        })
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(102)
    );

    const restartHud = trackHud(
      this.add
        .text(W - 112, barY + 10, "Restart", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          color: sessionTint,
          fontStyle: "700",
        })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setDepth(102)
        .setInteractive({ useHandCursor: true })
        .setPadding(6, 2, 6, 2)
    );
    restartHud.on("pointerdown", () => {
      this.scene.restart();
    });

    const changeHud = trackHud(
      this.add
        .text(W - 14, barY + 10, "Change player", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          color: sessionTint,
          fontStyle: "700",
        })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setDepth(102)
        .setInteractive({ useHandCursor: true })
        .setPadding(6, 2, 6, 2)
    );

    changeHud.on("pointerdown", () => {
      document.getElementById("change-player-btn")?.click();
    });

    const textStyle = {
      fontFamily: "'Courier New', monospace",
      fontSize: "14px",
      color: "#3e2723",
      fontStyle: "700",
    };

    /** Second row aligns with former 48px-tall HUD (icons vertically centered lower in the strip). */
    const iconMidY = barY + 38;

    /** Keep any HUD dog source asset visually aligned at about 29px tall/wide. */
    const hudDogTargetPx = 29;
    let hudDogScale = 0.8;
    const dogFrame = safeTextureFrame(this, TEX.hudDog);
    if (dogFrame) {
      try {
        const src = this.textures.get(TEX.hudDog).getSourceImage();
        const largestSide = Math.max(src?.width || 0, src?.height || 0);
        if (largestSide > 0) hudDogScale = hudDogTargetPx / largestSide;
      } catch {
        hudDogScale = 0.8;
      }

      trackHud(
        this.add
          .image(28, iconMidY, TEX.hudDog)
          .setScrollFactor(0)
          .setDepth(101)
          .setScale(hudDogScale)
      );
    }

    const rowTextY = iconMidY - 11;

    this.hudLives = trackHud(
      this.add
        .text(48, rowTextY, "", textStyle)
        .setScrollFactor(0)
        .setDepth(101)
    );

    /* Docs collected (counts up forever in infinite mode) */
    if (safeTextureFrame(this, TEX.hudDoc)) {
      trackHud(
        this.add
          .image(W / 2 - 110, iconMidY, TEX.hudDoc)
          .setScrollFactor(0)
          .setDepth(101)
          .setScale(1)
      );
    }

    this.hudDox = trackHud(
      this.add
        .text(W / 2 - 90, rowTextY, "", textStyle)
        .setScrollFactor(0)
        .setDepth(101)
    );

    /* Lap progress bar — fills as the player moves through the current lap;
       resets on wrap. The label to its left shows the current lap number. */
    this.hudLap = trackHud(
      this.add
        .text(W / 2 + 8, rowTextY, "", textStyle)
        .setScrollFactor(0)
        .setDepth(101)
    );

    const progX = W / 2 + 50;
    const progW = 80;
    const progH = 10;
    const progY = iconMidY - progH / 2;

    this.hudProgBg = trackHud(
      this.add
        .rectangle(progX + progW / 2, progY + progH / 2, progW, progH, 0x5c3d2e, 0.25)
        .setScrollFactor(0)
        .setDepth(101)
    );

    this.hudProgFill = trackHud(
      this.add
        .rectangle(progX, progY + progH / 2, 1, progH, 0xffb703, 1)
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(101)
    );

    this.hudProgWidth = progW;
    this.hudProgX = progX;

    /* Score */
    this.hudScore = trackHud(
      this.add
        .text(W - 20, rowTextY, "", textStyle)
        .setScrollFactor(0)
        .setDepth(101)
        .setOrigin(1, 0)
    );
  }

  raiseHudAboveOverlay() {
    if (!this.hudRaiseable?.length) return;
    let z = 250;
    for (const obj of this.hudRaiseable) {
      if (obj?.active) obj.setDepth(z++);
    }
  }

  updateHud() {
    this.hudLives.setText(`×${this.lives}`);
    this.hudDox.setText(`${this.docsCollected}`);
    this.hudLap.setText(`Lap ${this.loopCount + 1}`);

    /* Lap progress = how far through this lap the player has run. */
    const lapPct = this.player
      ? Phaser.Math.Clamp(this.player.x / LEVEL.worldWidth, 0, 1)
      : 0;
    this.hudProgFill.width = Math.max(lapPct * this.hudProgWidth, 1);

    this.hudScore.setText(`★ ${this.score}`);
  }

  /* ────────────────── Score popup ────────────────── */

  showScorePopup(x, y, amount, color) {
    const txt = this.add
      .text(x, y - 20, `+${amount}`, {
        fontFamily: "'Courier New', monospace",
        fontSize: "18px",
        color: color || "#ffe066",
        fontStyle: "900",
        stroke: "#3e2723",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(60);

    this.tweens.add({
      targets: txt,
      y: y - 70,
      alpha: { from: 1, to: 0 },
      scale: { from: 1.2, to: 0.6 },
      duration: 900,
      ease: "Cubic.easeOut",
      onComplete: () => txt.destroy(),
    });
  }

  /* ────────────────── Overlay (game over / win) ────────────────── */

  buildOverlay() {
    const W = this.scale.width;
    const H = this.scale.height;

    const bg = this.add
      .rectangle(W / 2, H / 2, W, H, 0x2c241c, 0.85)
      .setScrollFactor(0)
      .setDepth(200)
      .setVisible(false);

    const title = this.add
      .text(W / 2, H / 2 - 215, "", {
        fontFamily: "'Courier New', monospace",
        fontSize: "40px",
        color: "#ffe066",
        fontStyle: "900",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201)
      .setVisible(false);

    const endFrame = safeTextureFrame(this, TEX.opsyEnd);
    let endImage;
    if (endFrame) {
      endImage = this.add
        .image(W / 2, H / 2 - 58, TEX.opsyEnd)
        .setScrollFactor(0)
        .setDepth(201)
        .setVisible(false);
      const maxW = 420;
      const maxH = 280;
      const fw = endFrame.width || endFrame.cutWidth || maxW;
      const fh = endFrame.height || endFrame.cutHeight || maxH;
      const scale = Math.min(maxW / fw, maxH / fh);
      endImage.setScale(scale);
    } else {
      endImage = this.add
        .rectangle(W / 2, H / 2 - 58, 1, 1, 0x000000, 0)
        .setScrollFactor(0)
        .setDepth(201)
        .setVisible(false);
    }

    const sub = this.add
      .text(W / 2, H / 2 + 92, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#f4e8d4",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201)
      .setVisible(false);

    const detail = this.add
      .text(W / 2, H / 2 + 128, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#bcaaa4",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201)
      .setVisible(false);

    const promptLabel = this.isTouch
      ? "Tap Restart on the scoreboard"
      : "Click Restart on the scoreboard (or top bar)";
    const prompt = this.add
      .text(W / 2, H / 2 + 175, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#ffe066",
        fontStyle: "700",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201)
      .setVisible(false);

    prompt.setInteractive({ useHandCursor: true });
    prompt.on("pointerdown", () => {
      if (this.isGameOver || this.hasWon) this.scene.restart();
    });

    this.overlay = {
      bg,
      title,
      endImage,
      sub,
      detail,
      prompt,
      promptLabel,
      endArtReady: Boolean(endFrame),
    };
  }

  showOverlay(titleText, subText, detailText, promptText) {
    const { bg, title, endImage, sub, detail, prompt, promptLabel, endArtReady } = this.overlay;
    bg.setVisible(true);
    title.setVisible(true).setText(titleText);
    endImage.setVisible(Boolean(endArtReady));
    sub.setVisible(true).setText(subText);
    detail.setVisible(true).setText(detailText);
    prompt.setVisible(true).setText(promptText || promptLabel);

    this.tweens.add({
      targets: prompt,
      alpha: { from: 1, to: 0.3 },
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    this.raiseHudAboveOverlay();

    /* Tap playfield to retry (HUD strip excluded via hitArea / order). */
    this.time.delayedCall(300, () => {
      this.overlayTapRestart = this.input.on("pointerdown", (pointer) => {
        if (!this.isGameOver && !this.hasWon) return;
        if (pointer.y <= this.hudBottomY) return;
        this.scene.restart();
      });
    });
  }

  /* ────────────────── Mobile hint (no on-screen buttons) ────────────────── */

  buildMobileJumpHint() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.add
      .text(W / 2, H - 22, "Tap to jump", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "rgba(62,39,35,0.75)",
        fontStyle: "600",
        backgroundColor: "rgba(255,248,238,0.55)",
        padding: { x: 10, y: 4 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(300);
  }

  /**
   * Run speed: low at spawn, then eases up so the late rooms feel faster.
   * After a wrap, `speedFloor` clamps the lower end to whatever speed the
   * player ended the previous lap at, so successive loops never feel slower.
   */
  getRunSpeed() {
    const t = Phaser.Math.Clamp(this.player.x / LEVEL.speedRampAtX, 0, 1);
    const eased = Phaser.Math.Easing.Cubic.In(t);
    const ramped = Phaser.Math.Linear(LEVEL.baseRunSpeed, LEVEL.maxRunSpeed, eased);
    return Math.min(LEVEL.maxRunSpeed, Math.max(ramped, this.speedFloor));
  }

  /**
   * Infinite-runner wrap. When the player nears the right edge of the world,
   * snap them back to the spawn, respawn collected docs, and promote the
   * promote the current run speed to the new floor so the next lap starts at
   * (slightly above) the speed the player left off at.
   *
   * The camera is hard-cut to scrollX=0 and the screen flashes for a frame
   * to make the wrap read as an intentional loop instead of a bug.
   */
  wrapWorld() {
    const exitSpeed = this.getRunSpeed();
    this.loopCount += 1;
    this.speedFloor = Math.min(
      LEVEL.maxRunSpeed,
      exitSpeed + LEVEL.loopSpeedBoost
    );

    /* Teleport. Keep vertical velocity at 0 so the dog lands cleanly. */
    this.player.setPosition(LEVEL.playerSpawn.x, LEVEL.playerSpawn.y);
    this.player.setVelocity(0, 0);
    this.isJumping = false;
    this.coyoteCounter = LEVEL.coyoteMs;
    this.jumpBufferCounter = 0;

    /* Snap the camera so the wrap is instantaneous, then flash to mask it. */
    this.cameras.main.scrollX = 0;
    this.cameras.main.flash(180, 250, 240, 210, false);

    /* Respawn docs (the originals were destroyed when collected). */
    this.docGroup.clear(true, true);
    this.buildDocs();
    this.buildPlatforms();
    this.buildHazards();

    this.updateHud();
  }

  /* ────────────────── Game logic ────────────────── */

  collectDoc(docSprite) {
    if (!docSprite?.active || this.isGameOver || this.hasWon) return;

    const dx = docSprite.x;
    const dy = docSprite.y;
    docSprite.destroy();

    this.docsCollected += 1;
    this.score += LEVEL.scorePerDoc;

    this.showScorePopup(dx, dy, LEVEL.scorePerDoc, "#ffe066");
    this.collectEmitter?.emitParticleAt(dx, dy, 8);

    this.updateHud();
    /* Infinite mode: docs respawn each lap, so there is no win condition.
       Keep collecting forever — score and laps are the only things that grow. */
  }

  hitHazard() {
    if (this.isGameOver || this.hasWon || this.time.now < this.invulnerableUntil) {
      return;
    }

    this.lives -= 1;
    this.invulnerableUntil = this.time.now + LEVEL.invulnMs;
    this.updateHud();

    this.cameras.main.shake(160, 0.006);
    this.showScorePopup(this.player.x, this.player.y - 35, "Ouch!", "#ff6b6b");
    this.player.setVelocityY(Math.min(this.player.body.velocity.y, -280));

    if (this.lives <= 0) {
      this.triggerGameOver();
    }
  }

  triggerGameOver() {
    this.isGameOver = true;
    this.player.setVelocity(0, 0);
    const lapsFinished = this.loopCount;
    this.showOverlay(
      "NO LIVES LEFT",
      `Score: ${this.score}`,
      `Docs collected: ${this.docsCollected}    Laps: ${lapsFinished}`,
      "Loading scoreboard..."
    );

    const scheduleScoreboardReveal = () => {
      this.time.delayedCall(2400, () => {
        globalThis.dispatchEvent(new CustomEvent("opsy:scores-updated"));
      });
    };

    const player = this.registry.get("player");
    if (player?.id) {
      /* Always reveal scoreboard once submit settles; the old `.catch()` forgot to fire
       * `opsy:scores-updated`, so offline / HTTP errors left the overlay stuck on "Loading…".
       * Race avoids a hung fetch with no backend or flaky network. */
      const SUBMIT_DEADLINE_MS = 15_000;
      Promise.race([
        submitScore({
          userId: player.id,
          score: this.score,
          docsCollected: this.docsCollected,
          laps: lapsFinished,
        }),
        new Promise((_, reject) => {
          globalThis.setTimeout(
            () => reject(new Error("Score submit timed out")),
            SUBMIT_DEADLINE_MS,
          );
        }),
      ])
        .catch(() => {
          /* offline / server unreachable / timeout — still show leaderboard */
        })
        .finally(() => {
          scheduleScoreboardReveal();
        });
    } else {
      scheduleScoreboardReveal();
    }
  }

  /* ────────────────── Update loop ────────────────── */

  update(time, delta) {
    /* End-state input */
    if (this.isGameOver || this.hasWon) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
        this.scene.restart();
      }
      return;
    }

    /* ── Infinite loop: wrap the world once we cross the trigger line. ── */
    if (this.player.x >= LEVEL.wrapTriggerX) {
      this.wrapWorld();
      return;
    }

    /* ── Auto-run right; speed ramps with distance ── */
    const runSpeed = this.getRunSpeed();
    this.player.setVelocityX(runSpeed);
    this.player.setFlipX(false);

    /* Lap progress bar tracks the player every frame. */
    if (this.hudProgFill) {
      const lapPct = Phaser.Math.Clamp(this.player.x / LEVEL.worldWidth, 0, 1);
      this.hudProgFill.width = Math.max(lapPct * this.hudProgWidth, 1);
    }

    const onGround = this.player.body.blocked.down;

    /* ── Animations: run while on ground, jump in air (see BootScene) ── */
    if (!onGround && this.anims.exists("player_jump")) {
      this.player.anims.play("player_jump", true);
      this.player.anims.timeScale = 1;
    } else if (onGround && this.anims.exists("player_run")) {
      this.player.anims.play("player_run", true);
      /* Drive the leg-cycle from real movement so the stride covers a roughly
         constant ground distance at any speed. Without this the run anim plays
         at a fixed fps regardless of velocity, which makes the dog look like
         it's "moonwalking" while ramping up from baseRunSpeed. */
      const speedRatio = runSpeed / LEVEL.maxRunSpeed;
      this.player.anims.timeScale = Phaser.Math.Clamp(speedRatio, 0.55, 1.2);
    }

    /* ── Jump (coyote time + buffer) ── */
    if (onGround) {
      this.coyoteCounter = LEVEL.coyoteMs;
      this.isJumping = false;
    } else {
      this.coyoteCounter -= delta;
    }

    let touchJump = false;
    if (this.isTouch && this.hudBottomY > 0) {
      for (const key of ["pointer1", "pointer2"]) {
        const p = this.input[key];
        /* Full playfield: everything below the HUD bar registers as jump. */
        if (p && p.justDown && p.y > this.hudBottomY) {
          touchJump = true;
          break;
        }
      }
    }

    const kbJump =
      Phaser.Input.Keyboard.JustDown(this.spaceKey) ||
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.keys.w);

    if (touchJump && this.time.now < this.jumpInputUnlockAt) {
      touchJump = false;
    }

    if (kbJump || touchJump) {
      this.jumpBufferCounter = LEVEL.jumpBufferMs;
    } else {
      this.jumpBufferCounter -= delta;
    }

    if (this.jumpBufferCounter > 0 && this.coyoteCounter > 0 && !this.isJumping) {
      this.player.setVelocityY(LEVEL.jumpVelocity);
      this.isJumping = true;
      this.jumpBufferCounter = 0;
      this.coyoteCounter = 0;
    }

    /* ── Invulnerability visual ── */
    if (time < this.invulnerableUntil) {
      this.player.setAlpha(0.6 + 0.4 * Math.sin(time / 60));
    } else {
      this.player.setAlpha(1);
    }
  }
}
