/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flip } from "../src/render/flip";

/**
 * jsdom has no layout and no Web Animations API, which is fine: the part worth
 * testing is the arithmetic and the decisions — what counts as having moved,
 * what gets left alone — not whether Chromium can interpolate a transform.
 */

interface Fake {
  el: HTMLElement;
  at: (top: number, left?: number) => void;
  animate: ReturnType<typeof vi.fn>;
}

const fake = (top: number, left = 0): Fake => {
  const el = document.createElement("li");
  document.body.append(el);

  let box = { top, left };
  const animate = vi.fn();
  el.getBoundingClientRect = () => ({ top: box.top, left: box.left }) as DOMRect;
  Object.defineProperty(el, "animate", { value: animate, writable: true });

  return { el, at: (t, l = box.left) => (box = { top: t, left: l }), animate };
};

beforeEach(() => {
  document.body.replaceChildren();
});

describe("flip", () => {
  it("rearranges, then animates each row from where it used to be", () => {
    const a = fake(0);
    const b = fake(50);

    flip([a.el, b.el], () => {
      a.at(50);
      b.at(0);
    });

    expect(a.animate).toHaveBeenCalledTimes(1);
    const [frames] = a.animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    // Inverted first: put it back where it was, then travel to zero.
    expect(frames[0]).toMatchObject({ transform: "translate(0px, -50px)" });
    expect(frames[1]).toMatchObject({ transform: "translate(0, 0)" });

    expect(b.animate).toHaveBeenCalledTimes(1);
    const [other] = b.animate.mock.calls[0] as [Keyframe[]];
    expect(other[0]).toMatchObject({ transform: "translate(0px, 50px)" });
  });

  it("leaves rows that did not move alone", () => {
    const still = fake(0);
    const mover = fake(50);

    flip([still.el, mover.el], () => {
      mover.at(120);
    });

    expect(still.animate).not.toHaveBeenCalled();
    expect(mover.animate).toHaveBeenCalledTimes(1);
  });

  it("still rearranges when motion is off, without animating anything", () => {
    const row = fake(0);
    const rearrange = vi.fn(() => {
      row.at(80);
    });

    flip([row.el], rearrange, { instant: true });

    expect(rearrange).toHaveBeenCalledTimes(1);
    expect(row.animate).not.toHaveBeenCalled();
  });

  /* A row the patch removed has nowhere to travel to, and no box to measure. */
  it("skips a row the rearrangement removed", () => {
    const going = fake(0);
    const staying = fake(50);

    flip([going.el, staying.el], () => {
      going.el.remove();
      staying.at(0);
    });

    expect(going.animate).not.toHaveBeenCalled();
    expect(staying.animate).toHaveBeenCalledTimes(1);
  });

  it("tracks sideways travel as well, for a row changing nesting", () => {
    const row = fake(0, 0);

    flip([row.el], () => {
      row.at(10, 24);
    });

    const [frames] = row.animate.mock.calls[0] as [Keyframe[]];
    expect(frames[0]).toMatchObject({ transform: "translate(-24px, -10px)" });
  });

  it("ignores sub-pixel drift rather than animating a row that stayed put", () => {
    const row = fake(0);

    flip([row.el], () => {
      row.at(0.4);
    });

    expect(row.animate).not.toHaveBeenCalled();
  });
});
