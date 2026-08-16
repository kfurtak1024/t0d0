import { hueAt } from "../render/ring";

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  hue: number;
  life: number;
}

const COUNT = 90;
const GRAVITY = 0.22;
const FADE = 0.006;

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

  burst(origin: { x: number; y: number }): void {
    for (let i = 0; i < COUNT; i++) {
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
        // Same hue range as the rings, so the celebration belongs to the same system.
        hue: hueAt(Math.random()),
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
      // hsl rather than oklch: Canvas2D colour support lags CSS in older Safari.
      ctx.fillStyle = `hsl(${bit.hue.toFixed(0)} 68% 58%)`;
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
