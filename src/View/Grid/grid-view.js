/**
 * PF2E REMASTERED — GRID RENDERING (VIEW)
 * Draws the square grid, obstacles, movement highlights, and route previews.
 */
(function (root) {
  "use strict";

  const NS = (root.PF2e = root.PF2e || {});
  NS.View = NS.View || {};
  const FONT_STACK = "'Segoe UI', 'Inter', system-ui, -apple-system, sans-serif";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pseudoRandom(seed) {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
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

  class GridView {
    constructor(options) {
      const opts = options || {};
      this.cols = opts.cols === undefined ? 15 : opts.cols;
      this.rows = opts.rows === undefined ? 15 : opts.rows;
      this.cellSize = opts.cellSize === undefined ? 48 : opts.cellSize;
      this.width = this.cols * this.cellSize;
      this.height = this.rows * this.cellSize;
    }

    cellRect(x, y) {
      return {
        x: x * this.cellSize,
        y: y * this.cellSize,
        width: this.cellSize,
        height: this.cellSize,
      };
    }

    cellCenter(x, y) {
      return {
        x: (x + 0.5) * this.cellSize,
        y: (y + 0.5) * this.cellSize,
      };
    }

    cellAtPoint(px, py) {
      if (px < 0 || py < 0 || px >= this.width || py >= this.height) {
        return null;
      }
      return {
        x: Math.floor(px / this.cellSize),
        y: Math.floor(py / this.cellSize),
      };
    }

    draw(ctx) {
      ctx.save();

      ctx.fillStyle = "#14171b";
      ctx.fillRect(0, 0, this.width, this.height);

      // Very subtle checkerboard for readability on dark displays.
      ctx.fillStyle = "rgba(255, 255, 255, 0.014)";
      for (let y = 0; y < this.rows; y += 1) {
        for (let x = 0; x < this.cols; x += 1) {
          if ((x + y) % 2 === 0) {
            ctx.fillRect(x * this.cellSize, y * this.cellSize, this.cellSize, this.cellSize);
          }
        }
      }

      // Minor grid lines.
      ctx.strokeStyle = "rgba(112, 126, 142, 0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < this.cols; x += 1) {
        const px = Math.round(x * this.cellSize) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, this.height);
      }
      for (let y = 1; y < this.rows; y += 1) {
        const py = Math.round(y * this.cellSize) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(this.width, py);
      }
      ctx.stroke();

      // Major grid lines every 5 squares (25 ft blocks).
      ctx.strokeStyle = "rgba(154, 168, 184, 0.28)";
      ctx.beginPath();
      for (let x = 5; x < this.cols; x += 5) {
        const px = Math.round(x * this.cellSize) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, this.height);
      }
      for (let y = 5; y < this.rows; y += 5) {
        const py = Math.round(y * this.cellSize) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(this.width, py);
      }
      ctx.stroke();

      // Outer border.
      ctx.strokeStyle = "rgba(196, 209, 222, 0.38)";
      ctx.strokeRect(0.5, 0.5, this.width - 1, this.height - 1);

      ctx.restore();
    }

    drawReachable(ctx, cells) {
      ctx.save();

      for (const cell of cells) {
        const rect = this.cellRect(cell.x, cell.y);
        const cost = cell.costFeet === undefined ? cell.distanceFeet : cell.costFeet;
        const band = Math.min(5, Math.max(1, Math.round(cost / 5)));
        const alpha = Math.max(0.075, 0.16 - (band - 1) * 0.014);

        ctx.fillStyle = "rgba(86, 198, 255, " + alpha.toFixed(3) + ")";
        ctx.fillRect(rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4);

        ctx.strokeStyle = "rgba(126, 216, 255, 0.22)";
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x + 2.5, rect.y + 2.5, rect.width - 5, rect.height - 5);
      }

      ctx.restore();
    }

    drawObstacles(ctx, cells) {
      ctx.save();

      for (const cell of cells) {
        const rect = this.cellRect(cell.x, cell.y);
        const x = rect.x + 2;
        const y = rect.y + 2;
        const width = rect.width - 4;
        const height = rect.height - 4;

        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, "#4a535f");
        gradient.addColorStop(0.5, "#363e48");
        gradient.addColorStop(1, "#262d35");

        roundedRect(ctx, x, y, width, height, 3);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = "rgba(8, 10, 13, 0.9)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Top bevel.
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 3);
        ctx.lineTo(x + width - 3, y + 3);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Deterministic hairline crack so stone blocks do not look uniform.
        if ((cell.x * 3 + cell.y * 5) % 4 === 0) {
          ctx.beginPath();
          ctx.moveTo(x + width * 0.24, y + height * 0.7);
          ctx.lineTo(x + width * 0.48, y + height * 0.46);
          ctx.lineTo(x + width * 0.68, y + height * 0.58);
          ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    drawDifficultTerrain(ctx, cells) {
      ctx.save();

      for (const cell of cells) {
        const rect = this.cellRect(cell.x, cell.y);
        const x = rect.x + 2;
        const y = rect.y + 2;
        const width = rect.width - 4;
        const height = rect.height - 4;

        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, "rgba(58, 94, 62, 0.72)");
        gradient.addColorStop(1, "rgba(31, 55, 38, 0.72)");

        roundedRect(ctx, x, y, width, height, 3);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = "rgba(120, 186, 126, 0.34)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Deterministic undergrowth tufts: no randomness between renders.
        const seed = cell.x * 31 + cell.y * 17;
        for (let tuft = 0; tuft < 5; tuft += 1) {
          const rx = pseudoRandom(seed + tuft * 3.1);
          const ry = pseudoRandom(seed + tuft * 7.7 + 11);
          const radius = 2 + pseudoRandom(seed + tuft * 5.3 + 23) * 3.4;
          const cx = x + 5 + rx * (width - 10);
          const cy = y + 5 + ry * (height - 10);

          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(126, 196, 128, 0.32)";
          ctx.fill();
          ctx.strokeStyle = "rgba(88, 148, 96, 0.42)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Small leaf-like strokes.
        ctx.strokeStyle = "rgba(158, 214, 150, 0.3)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const lx = x + width * 0.28;
        const ly = y + height * 0.62;
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + width * 0.18, ly - height * 0.22);
        ctx.moveTo(lx + 6, ly + 2);
        ctx.lineTo(lx + width * 0.34, ly - height * 0.14);
        ctx.stroke();
      }

      ctx.restore();
    }

    drawStrikeTargets(ctx, cells) {
      ctx.save();
      for (const cell of cells) {
        const rect = this.cellRect(cell.x, cell.y);
        ctx.fillStyle = "rgba(224, 86, 86, 0.16)";
        ctx.fillRect(rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4);
        ctx.strokeStyle = "rgba(255, 128, 120, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rect.x + 2.5, rect.y + 2.5, rect.width - 5, rect.height - 5);
      }
      ctx.restore();
    }

    drawLineOfSight(ctx, from, to, visible) {
      const start = this.cellCenter(from.x, from.y);
      const end = this.cellCenter(to.x, to.y);
      const color = visible ? "rgba(126, 230, 157, 0.9)" : "rgba(255, 124, 116, 0.9)";

      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(7, 10, 13, 0.7)";
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(start.x, start.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }

    drawPath(ctx, path, valid) {
      if (!path || path.length < 2) {
        return;
      }

      const centers = path.map((cell) => this.cellCenter(cell.x, cell.y));
      const lineColor = valid ? "rgba(88, 198, 255, 0.96)" : "rgba(255, 116, 104, 0.96)";
      const glowColor = valid ? "rgba(88, 198, 255, 0.5)" : "rgba(255, 116, 104, 0.5)";
      const dotColor = valid ? "#b8ebff" : "#ffc0b9";

      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Dark underlay keeps the route readable over highlights.
      ctx.beginPath();
      ctx.moveTo(centers[0].x, centers[0].y);
      for (let i = 1; i < centers.length; i += 1) {
        ctx.lineTo(centers[i].x, centers[i].y);
      }
      ctx.strokeStyle = "rgba(9, 14, 18, 0.72)";
      ctx.lineWidth = 8;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(centers[0].x, centers[0].y);
      for (let i = 1; i < centers.length; i += 1) {
        ctx.lineTo(centers[i].x, centers[i].y);
      }
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 3.5;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 9;
      ctx.stroke();

      // Waypoint dots.
      ctx.shadowBlur = 0;
      for (let i = 1; i < centers.length - 1; i += 1) {
        ctx.beginPath();
        ctx.arc(centers[i].x, centers[i].y, 3, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
      }

      // Destination marker.
      const destination = centers[centers.length - 1];
      ctx.beginPath();
      ctx.arc(destination.x, destination.y, this.cellSize * 0.19, 0, Math.PI * 2);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.restore();
    }

    drawHoverCell(ctx, cell, valid) {
      const rect = this.cellRect(cell.x, cell.y);
      ctx.save();
      ctx.strokeStyle = valid ? "rgba(184, 235, 255, 0.92)" : "rgba(255, 150, 140, 0.92)";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.width - 3, rect.height - 3);
      ctx.restore();
    }

    /**
     * Debug/demo overlay for the canonical cover rays. Each ray runs from the
     * attacker's best corner to one corner of the target's square. A blocked
     * ray is red, a creature-blocked ray is amber, and a clear ray is teal.
     */
    drawCoverRays(ctx, rays) {
      if (!Array.isArray(rays) || rays.length === 0) {
        return;
      }

      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;

      for (const ray of rays) {
        const from = {
          x: ray.from.x * this.cellSize,
          y: ray.from.y * this.cellSize,
        };
        const to = {
          x: ray.to.x * this.cellSize,
          y: ray.to.y * this.cellSize,
        };

        let color = "rgba(116, 226, 204, 0.72)";
        if (ray.blocked) {
          color = "rgba(255, 116, 104, 0.82)";
        } else if (ray.creatureBlocked) {
          color = "rgba(255, 178, 74, 0.82)";
        }

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = color;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(to.x, to.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }

      ctx.setLineDash([]);
      ctx.restore();
    }

    /** Orange corner brackets mark a target that is Off-Guard from flanking. */
    drawFlankedCell(ctx, cell) {
      const rect = this.cellRect(cell.x, cell.y);
      const inset = 3;
      const arm = Math.max(8, rect.width * 0.28);
      const x = rect.x + inset;
      const y = rect.y + inset;
      const right = rect.x + rect.width - inset;
      const bottom = rect.y + rect.height - inset;

      ctx.save();
      ctx.strokeStyle = "rgba(255, 178, 74, 0.98)";
      ctx.lineWidth = 3;
      ctx.shadowColor = "rgba(255, 178, 74, 0.55)";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(x, y + arm);
      ctx.lineTo(x, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(right - arm, y);
      ctx.lineTo(right, y);
      ctx.lineTo(right, y + arm);
      ctx.moveTo(right, bottom - arm);
      ctx.lineTo(right, bottom);
      ctx.lineTo(right - arm, bottom);
      ctx.moveTo(x + arm, bottom);
      ctx.lineTo(x, bottom);
      ctx.lineTo(x, bottom - arm);
      ctx.stroke();
      ctx.restore();
    }

    drawPathLabel(ctx, cell, text, kind) {
      const rect = this.cellRect(cell.x, cell.y);
      const height = 20;

      ctx.save();
      ctx.font = "600 11px " + FONT_STACK;
      const width = ctx.measureText(text).width + 16;

      let x = rect.x + rect.width / 2 - width / 2;
      let y = rect.y - height - 5;
      if (y < 3) {
        y = rect.y + rect.height + 5;
      }
      x = clamp(x, 3, this.width - width - 3);
      y = clamp(y, 3, this.height - height - 3);

      let fill = "rgba(9, 14, 18, 0.9)";
      let stroke = "rgba(126, 216, 255, 0.8)";
      let textColor = "#c7efff";
      if (kind === "invalid" || kind === "blocked") {
        stroke = "rgba(255, 140, 130, 0.85)";
        textColor = "#ffd0cb";
      } else if (kind === "flank") {
        stroke = "rgba(255, 178, 74, 0.95)";
        textColor = "#ffd9a3";
      } else if (kind === "cover") {
        stroke = "rgba(116, 226, 204, 0.95)";
        textColor = "#c6f5eb";
      }

      roundedRect(ctx, x, y, width, height, 6);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = textColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + width / 2, y + height / 2 + 0.5);
      ctx.restore();
    }
  }

  NS.View.GridView = GridView;
})(typeof globalThis !== "undefined" ? globalThis : this);
