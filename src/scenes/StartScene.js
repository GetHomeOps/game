const Phaser = globalThis.Phaser;

export default class StartScene extends Phaser.Scene {
  constructor() {
    super({ key: "StartScene" });
  }

  create() {
    /* Signed in from the HTML form — they already pressed "Start game". */
    if (this.registry.get("player")) {
      this.scene.start("GameScene");
      return;
    }

    const W = this.scale.width;
    const H = this.scale.height;
    this.isTouch = this.sys.game.device.input.touch;

    const gfx = this.add.graphics();
    gfx.fillGradientStyle(0xf4e8d4, 0xf4e8d4, 0xc9a96e, 0xc9a96e, 1);
    gfx.fillRect(0, 0, W, H);

    gfx.fillStyle(0x6bbf59, 1);
    gfx.fillRect(0, H - 80, W, 80);
    gfx.fillStyle(0x4e9a44, 1);
    for (let i = 0; i < W; i += 12) {
      gfx.fillTriangle(i, H - 80, i + 6, H - 92, i + 12, H - 80);
    }

    gfx.fillStyle(0x8b6914, 0.12);
    gfx.fillRect(W / 2 - 220, 60, 440, 380);
    gfx.fillStyle(0x5c3d2e, 0.08);
    gfx.fillRect(W / 2 - 210, 70, 420, 360);

    this.add
      .text(W / 2, 105, "OPSY", {
        fontFamily: "'Courier New', monospace",
        fontSize: "64px",
        color: "#5c3d2e",
        fontStyle: "900",
      })
      .setOrigin(0.5);

    this.add
      .text(W / 2, 100, "OPSY", {
        fontFamily: "'Courier New', monospace",
        fontSize: "64px",
        color: "#ffe066",
        fontStyle: "900",
      })
      .setOrigin(0.5);

    this.add
      .text(W / 2, 150, "Wopsy", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#5c3d2e",
        fontStyle: "600",
      })
      .setOrigin(0.5);

    if (this.textures.exists("spr_player")) {
      const dog = this.add.sprite(W / 2, 265, "spr_player", 0);
      /* Source PNG is now 512×512 (was 1254×1254 before the iOS-memory
         optimization in scripts/optimize_assets_for_mobile.sh). Dividing by
         the source size keeps the rendered dog the same on screen. */
      dog.setScale(((384 * 0.4) / 512) * 1.3);
    } else {
      const dog = this.add.sprite(W / 2, 265, "tex_player");
      dog.setScale(2.5);
    }

    this.add
      .text(W / 2, 360, "Auto-run: collect docs, jump hazards, speed ramps up!", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#6d4c41",
        fontStyle: "italic",
      })
      .setOrigin(0.5);

    const promptLabel = this.isTouch
      ? "Tap to start"
      : "Click anywhere or press SPACE to start";
    const startText = this.add
      .text(W / 2, 410, promptLabel, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "18px",
        color: "#3e2723",
        fontStyle: "700",
        backgroundColor: "rgba(255,224,130,0.6)",
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5);

    this.input.once("pointerdown", () => this.startGame());

    this.tweens.add({
      targets: startText,
      alpha: { from: 1, to: 0.3 },
      duration: 800,
      yoyo: true,
      repeat: -1,
    });

    const controlHint = this.isTouch
      ? "Tap below the bar to jump · Restart in the top bar"
      : "Runs automatically — Jump: SPACE / W / ↑ · Restart in the top bar";

    this.add
      .text(W / 2, 470, controlHint, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#8d6e63",
      })
      .setOrigin(0.5);

    this.spaceKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );
  }

  startGame() {
    if (this._opsyRunStarted) return;
    this._opsyRunStarted = true;
    this.scene.start("GameScene");
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.startGame();
    }
  }
}
