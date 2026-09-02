import { hueAt, ringRgb, type RingTokens } from "../render/ring";

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  /*
   * Resolved at the burst rather than kept as a hue and converted per frame:
   * the theme cannot change under a shower that is already in the air, and a
   * hundred colour conversions a frame is work for an answer that never moves.
   */
  fill: string;
  life: number;
}

const COUNT = 90;
const GRAVITY = 0.22;
const FADE = 0.006;

export interface Burst {
  /** How many bits. The bigger the moment, the bigger the shower. */
  count?: number;
  /**
   * Centre of the colour spread. Each milestone wears the hue the day ring
   * turns as it lands, so the burst and the ring are visibly the same event.
   * Left out, the bits take the row rings' own range.
   */
  hue?: number;
  spread?: number;
}

/**
 * The ring tokens as they stand in this theme, read off the document.
 *
 * The canvas cannot resolve a `var()`, and the two themes genuinely differ —
 * dark starts lighter and lifts the warm band far less. Read per burst, so a
 * theme changed in Settings is honoured by the next shower.
 *
 * The fallbacks are light mode's, for the one case that can reach here without
 * a stylesheet: a burst fired before the CSS has landed.
 */
function ringTokens(): RingTokens {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: number): number => {
    const raw = style.getPropertyValue(name).trim();
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    // `--ring-l` and `--ring-lift` are percentages; `--ring-c` is not.
    return raw.endsWith("%") ? value / 100 : value;
  };
  return { l: read("--ring-l", 0.56), c: read("--ring-c", 0.15), lift: read("--ring-lift", 0.1) };
}

/** Hand-rolled so the app keeps its zero runtime dependencies. */
export class Confetti {
  #canvas: HTMLCanvasElement;
  #ctx: CanvasRenderingContext2D;
  #bits: Bit[] = [];
  #raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    this.#resize();
    addEventListener("resize", () => {
      this.#resize();
    });
  }

  #resize(): void {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.#canvas.width = innerWidth * dpr;
    this.#canvas.height = innerHeight * dpr;
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  burst(origin: { x: number; y: number }, options: Burst = {}): void {
    const count = options.count ?? COUNT;
    const spread = options.spread ?? 26;
    const tokens = ringTokens();
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 8;
      this.#bits.push({
        x: origin.x,
        y: origin.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        w: 5 + Math.random() * 5,
        h: 3 + Math.random() * 4,
        // Same hue range as the rings, so the celebration belongs to the same
        // system — narrowed around the milestone's own colour when it has one,
        // and put through the ring's own formula so it is that colour rather
        // than one that resembles it.
        fill: ringRgb(
          options.hue === undefined
            ? hueAt(Math.random())
            : options.hue + (Math.random() - 0.5) * 2 * spread,
          tokens,
        ),
        life: 1,
      });
    }
    if (this.#raf === 0) {
      this.#raf = requestAnimationFrame(() => {
        this.#tick();
      });
    }
  }

  #tick(): void {
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    this.#bits = this.#bits.filter((bit) => bit.life > 0 && bit.y < innerHeight + 40);

    for (const bit of this.#bits) {
      bit.vy += GRAVITY;
      bit.vx *= 0.995;
      bit.x += bit.vx;
      bit.y += bit.vy;
      bit.rot += bit.vr;
      bit.life -= FADE;

      ctx.save();
      ctx.translate(bit.x, bit.y);
      ctx.rotate(bit.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, bit.life));
      ctx.fillStyle = bit.fill;
      ctx.fillRect(-bit.w / 2, -bit.h / 2, bit.w, bit.h);
      ctx.restore();
    }

    if (this.#bits.length > 0) {
      this.#raf = requestAnimationFrame(() => {
        this.#tick();
      });
    } else {
      this.#raf = 0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
  }
}
