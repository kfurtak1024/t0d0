/**
 * @vitest-environment jsdom
 *
 * The arc maths is the one part of the UI that can break silently: a wrong
 * dasharray still renders, just wrongly, and no other test would notice.
 */
import { describe, expect, it } from "vitest";
import { dayStroke, hueAt, makeRing, paintRing } from "../src/render/ring";

const SIZE = 26;
const WIDTH = 3;
const circumference = (size: number, width: number): number =>
  2 * Math.PI * (size / 2 - width / 2 - 0.5);

const dash = (circle: Element): [number, number] => {
  const [arc, gap] = (circle.getAttribute("stroke-dasharray") ?? "").split(" ").map(Number);
  return [arc ?? 0, gap ?? 0];
};

const painted = (ring: ReturnType<typeof makeRing>): number =>
  ring.segments.filter((seg) => seg.style.stroke !== "transparent").length;

describe("makeRing", () => {
  it("gives a counted item one arc per unit", () => {
    expect(makeRing(SIZE, WIDTH, 3).segments).toHaveLength(3);
    expect(makeRing(SIZE, WIDTH, 8).segments).toHaveLength(8);
  });

  it("sweeps instead of segmenting for a plain item", () => {
    const ring = makeRing(SIZE, WIDTH, 1);
    expect(ring.segments).toHaveLength(1);
    expect(ring.continuous).toBe(true);
  });

  it("sweeps once the arcs would be too thin to read", () => {
    // Above eight, segments stop being legible, so it becomes one arc.
    expect(makeRing(SIZE, WIDTH, 9).continuous).toBe(true);
    expect(makeRing(SIZE, WIDTH, 99).segments).toHaveLength(1);
  });

  it("draws each segment as one dash covering the rest of the circle", () => {
    const target = 5;
    const ring = makeRing(SIZE, WIDTH, target);
    const [arc, rest] = dash(ring.segments[0] as Element);

    // A segment is "arc on, everything else off", positioned by its offset.
    expect(arc + rest).toBeCloseTo(ring.circumference, 5);
    expect(arc).toBeGreaterThan(0);
    expect(arc * target).toBeLessThan(ring.circumference);
  });

  it("leaves a gap between neighbouring arcs", () => {
    const target = 4;
    const ring = makeRing(SIZE, WIDTH, target);
    const [arc] = dash(ring.segments[0] as Element);
    const step = Math.abs(
      Number(ring.segments[1]?.getAttribute("stroke-dashoffset") ?? 0) -
        Number(ring.segments[0]?.getAttribute("stroke-dashoffset") ?? 0),
    );

    expect(step).toBeGreaterThan(arc);
    expect(step * target).toBeCloseTo(ring.circumference, 5);
  });

  it("spaces the segments evenly around the circle", () => {
    const ring = makeRing(SIZE, WIDTH, 4);
    const offsets = ring.segments.map((seg) =>
      Number(seg.getAttribute("stroke-dashoffset") ?? "0"),
    );
    const steps = offsets.slice(1).map((value, i) => value - (offsets[i] ?? 0));
    for (const step of steps) expect(step).toBeCloseTo(steps[0] ?? 0, 6);
  });

  it("reports the circumference it was built from", () => {
    const ring = makeRing(40, 4, 1);
    expect(ring.circumference).toBeCloseTo(circumference(40, 4), 6);
  });

  it("scales the checkmark with the ring", () => {
    const small = makeRing(20, 3, 1).check.getAttribute("d") ?? "";
    const large = makeRing(40, 3, 1).check.getAttribute("d") ?? "";
    expect(small).not.toBe(large);
    expect(large).toMatch(/^M[\d.]+ [\d.]+ L/);
  });
});

describe("paintRing", () => {
  it("colours exactly as many segments as are done", () => {
    const ring = makeRing(SIZE, WIDTH, 3);

    paintRing(ring, 0, 3);
    expect(painted(ring)).toBe(0);

    paintRing(ring, 2, 3);
    expect(painted(ring)).toBe(2);

    paintRing(ring, 3, 3);
    expect(painted(ring)).toBe(3);
  });

  it("uncolours segments when a count goes back down", () => {
    const ring = makeRing(SIZE, WIDTH, 3);
    paintRing(ring, 3, 3);
    paintRing(ring, 1, 3);
    expect(painted(ring)).toBe(1);
  });

  it("draws a sweeping arc as a dash offset, not as segments", () => {
    const ring = makeRing(40, 4, 1);
    paintRing(ring, 0.5, 1);

    const arc = ring.segments[0] as Element;
    const offset = Number(arc.getAttribute("stroke-dashoffset"));
    expect(offset).toBeCloseTo(ring.circumference * 0.5, 6);
  });

  it("closes the sweep completely at full", () => {
    const ring = makeRing(40, 4, 1);
    paintRing(ring, 1, 1);
    expect(Number((ring.segments[0] as Element).getAttribute("stroke-dashoffset"))).toBeCloseTo(
      0,
      6,
    );
  });

  it("shows nothing at all at zero", () => {
    const ring = makeRing(40, 4, 1);
    paintRing(ring, 0, 1);
    expect((ring.segments[0] as SVGElement).style.stroke).toBe("transparent");
  });

  it("never overshoots when a count exceeds its target", () => {
    const ring = makeRing(40, 4, 1);
    paintRing(ring, 9, 1);
    expect(Number((ring.segments[0] as Element).getAttribute("stroke-dashoffset"))).toBeCloseTo(
      0,
      6,
    );
  });
});

describe("paintRing colour override", () => {
  it("uses the given colour instead of the row sweep", () => {
    // The day's ring wears the rainbow while every row keeps the indigo→green
    // sweep that matches its finished frame.
    const ring = makeRing(40, 4, 1);
    paintRing(ring, 0.5, 1, "rebeccapurple");
    expect((ring.segments[0] as SVGElement).style.stroke).toBe("rebeccapurple");
    expect(ring.check.style.stroke).toBe("rebeccapurple");
  });

  it("still shows nothing at zero, whatever the colour", () => {
    const ring = makeRing(40, 4, 1);
    paintRing(ring, 0, 1, "rebeccapurple");
    expect((ring.segments[0] as SVGElement).style.stroke).toBe("transparent");
  });
});

describe("dayStroke", () => {
  it("carries the hue and reads its lightness from the theme's tokens", () => {
    const stroke = dayStroke(260);
    expect(stroke).toContain("260.0");
    expect(stroke).toContain("var(--ring-l)");
    expect(stroke).toContain("var(--ring-c)");
  });

  it("fades to an alpha for the track, which is how red shows before any arc", () => {
    expect(dayStroke(25)).not.toContain("/");
    expect(dayStroke(25, 0.2)).toContain("/ 20%");
  });

  it("lifts the warm band and leaves the cool end alone", () => {
    // Yellow held at the ring's fixed lightness renders olive, so the band
    // around it is lifted; blue and violet need none of it.
    const lift = (hue: number): number =>
      Number(/var\(--ring-lift\) \* ([\d.]+)/.exec(dayStroke(hue))?.[1] ?? "0");

    expect(lift(95)).toBeCloseTo(1, 2);
    expect(lift(60)).toBeGreaterThan(0.5);
    expect(lift(150)).toBeLessThan(0.5);
    expect(lift(260)).toBeLessThan(0.01);
    expect(lift(320)).toBeLessThan(0.01);
  });
});

describe("hueAt", () => {
  it("runs indigo to green across the range", () => {
    expect(hueAt(0)).toBeCloseTo(268, 6);
    expect(hueAt(1)).toBeCloseTo(150, 6);
  });

  it("moves monotonically, so colour tracks progress", () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map(hueAt);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i] as number).toBeLessThan(steps[i - 1] as number);
    }
  });

  it("clamps outside the range rather than inventing hues", () => {
    expect(hueAt(-5)).toBeCloseTo(268, 6);
    expect(hueAt(5)).toBeCloseTo(150, 6);
  });
});
