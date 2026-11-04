/**
 * PF2E REMASTERED — TOKEN RENDERING (VIEW)
 * Foundry-style round tokens with a selection ring and name plate.
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};
  const FONT_STACK = "'Segoe UI', 'Inter', system-ui, -apple-system, sans-serif";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hpColor(ratio) {
    if (ratio > 0.5) {
      return "#5bbe84";
    }
    if (ratio > 0.25) {
      return "#d6a84b";
    }
    return "#e05d62";
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      return;
    }

    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  class TokenView {
    constructor(combatant, grid, color) {
      this.token = combatant;
      this.grid = grid;
      this.color = color || "#8a94a3";
      this.radius = grid.cellSize * 0.34;
    }

    get center() {
      return this.grid.cellCenter(this.token.x, this.token.y);
    }

    hitTest(px, py) {
      const center = this.center;
      return Math.hypot(px - center.x, py - center.y) <= this.radius + 3;
    }

    draw(ctx, selected) {
      const center = this.center;
      const cx = center.x;
      const cy = center.y;
      const radius = this.radius;
      const defeated = this.token.isDefeated === true;
      const bodyColor = defeated ? "#5c636d" : this.color;

      ctx.save();

      // Drop shadow.
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.58)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = bodyColor;
      ctx.fill();
      ctx.restore();

      // Volume tint over the body color. Defeated tokens are desaturated and
      // semi-transparent so the board state is readable at a glance.
      ctx.save();
      ctx.globalAlpha = defeated ? 0.55 : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
      ctx.clip();
      const gradient = ctx.createRadialGradient(
        cx - radius * 0.35,
        cy - radius * 0.42,
        radius * 0.12,
        cx,
        cy,
        radius * 1.15,
      );
      gradient.addColorStop(0, "rgba(255, 255, 255, 0.55)");
      gradient.addColorStop(0.42, "rgba(255, 255, 255, 0.08)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0.38)");
      ctx.fillStyle = gradient;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      ctx.restore();

      // Rim.
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 1.25, 0, Math.PI * 2);
      ctx.strokeStyle = selected
        ? "#f2c96b"
        : defeated
          ? "rgba(190, 196, 205, 0.5)"
          : "rgba(255, 255, 255, 0.82)";
      ctx.lineWidth = selected ? 3 : 2;
      ctx.stroke();

      if (selected) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(242, 201, 107, 0.82)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();
      }

      // Token glyph: skull for defeated combatants, initial otherwise.
      ctx.save();
      ctx.fillStyle = defeated ? "rgba(225, 229, 235, 0.82)" : "rgba(255, 255, 255, 0.96)";
      ctx.font =
        "700 " +
        Math.round(radius * (defeated ? 0.82 : 0.95)) +
        "px " +
        FONT_STACK;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
      ctx.shadowBlur = 3;
      const glyph = defeated
        ? "☠"
        : this.token.initial || this.token.name.charAt(0).toUpperCase();
      ctx.fillText(glyph, cx, cy + 1);
      ctx.restore();

      this.drawHpBar(ctx, cx, cy - radius - 8, radius * 2, defeated);

      ctx.save();
      ctx.globalAlpha = defeated ? 0.7 : 1;
      this.drawNamePlate(ctx, cx, cy + radius + 9);
      ctx.restore();

      ctx.restore();
    }

    drawHpBar(ctx, cx, centerY, width, defeated) {
      if (!Number.isInteger(this.token.maxHP) || this.token.maxHP <= 0) {
        return;
      }

      const ratio = clamp(this.token.currentHP / this.token.maxHP, 0, 1);
      const height = 4;
      const x = clamp(cx - width / 2, 4, this.grid.width - width - 4);
      const y = clamp(centerY - height / 2, 4, this.grid.height - height - 4);

      ctx.save();
      roundedRect(ctx, x, y, width, height, 2);
      ctx.fillStyle = "rgba(8, 10, 13, 0.82)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();

      if (ratio > 0) {
        const fillWidth = Math.max(1, (width - 2) * ratio);
        roundedRect(ctx, x + 1, y + 1, fillWidth, height - 2, 1.5);
        ctx.fillStyle = defeated ? "#6f7681" : hpColor(ratio);
        ctx.fill();
      }
      ctx.restore();
    }

    drawNamePlate(ctx, cx, top) {
      const text = this.token.name;
      const height = 16;

      ctx.save();
      ctx.font = "600 10px " + FONT_STACK;
      const width = ctx.measureText(text).width + 12;
      const x = clamp(cx - width / 2, 4, this.grid.width - width - 4);
      const y = clamp(top, 4, this.grid.height - height - 4);

      roundedRect(ctx, x, y, width, height, 5);
      ctx.fillStyle = "rgba(8, 10, 13, 0.74)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "rgba(230, 233, 238, 0.92)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + width / 2, y + height / 2 + 0.5);
      ctx.restore();
    }
  }

  NS.View.TokenView = TokenView;
})(typeof globalThis !== "undefined" ? globalThis : this);
