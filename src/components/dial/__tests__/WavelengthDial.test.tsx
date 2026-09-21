// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { describeArcSegment, targetWedges } from "@/lib/game/geometry";
import { RADII } from "@/lib/game/constants";

import { WavelengthDial } from "../WavelengthDial";

/**
 * jsdom implements neither of these, and both are load-bearing for the dial.
 * Identity CTM means one SVG user unit equals one client pixel, which keeps
 * the pointer assertions readable.
 */
beforeAll(() => {
  if (!("DOMPoint" in globalThis)) {
    class FakeDOMPoint {
      constructor(
        public x = 0,
        public y = 0,
      ) {}
      matrixTransform() {
        return { x: this.x, y: this.y };
      }
    }
    Object.defineProperty(globalThis, "DOMPoint", { value: FakeDOMPoint, writable: true });
  }
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    value: () => ({ inverse: () => ({}) }),
    writable: true,
  });
  Object.defineProperty(SVGElement.prototype, "setPointerCapture", { value: vi.fn(), writable: true });
  Object.defineProperty(SVGElement.prototype, "releasePointerCapture", { value: vi.fn(), writable: true });
  Object.defineProperty(SVGElement.prototype, "hasPointerCapture", { value: () => true, writable: true });
});

afterEach(cleanup);

const baseProps = {
  leftLabel: "Underrated",
  rightLabel: "Overrated",
  needlePosition: 0.5,
  screenOpen: false,
  interactive: false,
} as const;

describe("hiding the target", () => {
  const TARGET = 0.7314;

  it("does not render the target at all for a viewer without it", () => {
    const { container } = render(
      <WavelengthDial {...baseProps} targetCenter={null} />,
    );

    expect(screen.queryByTestId("target-wedges")).toBeNull();

    // Not merely absent from the accessibility tree — absent from the markup.
    // If this ever fails, someone has started hiding the target with CSS.
    const markup = container.innerHTML;
    for (const wedge of targetWedges(TARGET)) {
      const path = describeArcSegment(
        wedge.from,
        wedge.to,
        RADII.bandInner,
        RADII.bandOuter,
      );
      expect(markup).not.toContain(path);
    }
    expect(markup).not.toContain(String(TARGET));
  });

  it("renders all five wedges for a viewer entitled to the target", () => {
    render(<WavelengthDial {...baseProps} targetCenter={TARGET} />);

    const band = screen.getByTestId("target-wedges");
    const paths = band.querySelectorAll("path[data-points]");
    expect(paths).toHaveLength(5);
    expect([...paths].map((p) => p.getAttribute("data-points"))).toEqual([
      "2", "3", "4", "3", "2",
    ]);
  });
});

describe("the cover screen", () => {
  it("swings both halves open on reveal and closes them again", () => {
    const { rerender } = render(
      <WavelengthDial {...baseProps} targetCenter={0.5} screenOpen={false} />,
    );

    const left = () => screen.getByTestId("cover-left");
    const right = () => screen.getByTestId("cover-right");

    expect(left().style.transform).toBe("rotate(0deg)");
    expect(right().style.transform).toBe("rotate(0deg)");

    rerender(<WavelengthDial {...baseProps} targetCenter={0.5} screenOpen={true} />);
    expect(left().style.transform).toBe("rotate(-90deg)");
    expect(right().style.transform).toBe("rotate(90deg)");
  });
});

describe("keyboard control", () => {
  it("moves by a step, and by a fine step with shift", () => {
    const onChange = vi.fn();
    render(
      <WavelengthDial {...baseProps} targetCenter={null} interactive onChange={onChange} />,
    );
    const needle = screen.getByTestId("needle");

    fireEvent.keyDown(needle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(0.505);

    fireEvent.keyDown(needle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(0.495);

    fireEvent.keyDown(needle, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(0.501);
  });

  it("jumps to the ends and pages coarsely", () => {
    const onChange = vi.fn();
    render(
      <WavelengthDial {...baseProps} targetCenter={null} interactive onChange={onChange} />,
    );
    const needle = screen.getByTestId("needle");

    fireEvent.keyDown(needle, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(needle, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(needle, { key: "PageUp" });
    expect(onChange).toHaveBeenLastCalledWith(0.55);
  });

  it("clamps at the ends rather than wrapping", () => {
    const onChange = vi.fn();
    render(
      <WavelengthDial
        {...baseProps}
        needlePosition={1}
        targetCenter={null}
        interactive
        onChange={onChange}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("needle"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("locks on Enter and Space", () => {
    const onLock = vi.fn();
    render(
      <WavelengthDial {...baseProps} targetCenter={null} interactive onLock={onLock} />,
    );
    const needle = screen.getByTestId("needle");

    fireEvent.keyDown(needle, { key: "Enter" });
    fireEvent.keyDown(needle, { key: " " });
    expect(onLock).toHaveBeenCalledTimes(2);
  });

  it("ignores input entirely when not interactive", () => {
    const onChange = vi.fn();
    const onLock = vi.fn();
    render(
      <WavelengthDial
        {...baseProps}
        targetCenter={null}
        interactive={false}
        onChange={onChange}
        onLock={onLock}
      />,
    );
    const needle = screen.getByTestId("needle");

    fireEvent.keyDown(needle, { key: "ArrowRight" });
    fireEvent.keyDown(needle, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onLock).not.toHaveBeenCalled();
    expect(needle).toHaveAttribute("tabindex", "-1");
    expect(needle).toHaveAttribute("aria-disabled", "true");
  });
});

describe("accessibility", () => {
  it("exposes the needle as a slider with a readable value", () => {
    render(
      <WavelengthDial {...baseProps} needlePosition={0.25} targetCenter={null} interactive />,
    );
    const needle = screen.getByRole("slider");

    expect(needle).toHaveAttribute("aria-valuenow", "250");
    expect(needle).toHaveAttribute("aria-valuemin", "0");
    expect(needle).toHaveAttribute("aria-valuemax", "1000");
    expect(needle).toHaveAttribute("aria-valuetext", "25% toward Overrated");
    expect(needle).toHaveAttribute("tabindex", "0");
  });

  it("labels the dial with both poles of the spectrum", () => {
    render(<WavelengthDial {...baseProps} targetCenter={null} />);
    expect(
      screen.getByRole("group", { name: /Underrated to Overrated/i }),
    ).toBeInTheDocument();
  });
});

describe("pointer control", () => {
  it("jumps the needle to where the dial was tapped", () => {
    const onChange = vi.fn();
    const { container } = render(
      <WavelengthDial {...baseProps} targetCenter={null} interactive onChange={onChange} />,
    );
    const svg = container.querySelector("svg")!;

    // Straight up from the pivot is the centre of the dial.
    fireEvent.pointerDown(svg, { clientX: 500, clientY: 100, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(0.5);

    // Left of the pivot, above the baseline.
    fireEvent.pointerDown(svg, { clientX: 100, clientY: 500, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("does not respond to pointer input when not interactive", () => {
    const onChange = vi.fn();
    const { container } = render(
      <WavelengthDial {...baseProps} targetCenter={null} interactive={false} onChange={onChange} />,
    );
    fireEvent.pointerDown(container.querySelector("svg")!, {
      clientX: 500, clientY: 100, pointerId: 1,
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits once when the drag ends", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <WavelengthDial {...baseProps} targetCenter={null} interactive onCommit={onCommit} />,
    );
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { clientX: 500, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 700, clientY: 300, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe("the reveal centre mark", () => {
  it("is absent while the target is still hidden from the viewer", () => {
    render(<WavelengthDial {...baseProps} targetCenter={null} />);
    expect(screen.queryByTestId("target-centre-mark")).toBeNull();
  });

  it("is absent for the Psychic before the reveal", () => {
    // The Psychic sees the band while writing a clue, but the sighting line is
    // a reveal affordance, not a clue-writing one.
    render(<WavelengthDial {...baseProps} targetCenter={0.4} markTargetCentre={false} />);
    expect(screen.queryByTestId("target-centre-mark")).toBeNull();
  });

  it("appears at the reveal, and the numbers are painted over it", () => {
    render(<WavelengthDial {...baseProps} targetCenter={0.4} markTargetCentre screenOpen />);
    const band = screen.getByTestId("target-wedges");
    const mark = screen.getByTestId("target-centre-mark");

    expect(mark).toBeInTheDocument();

    // Document order is what decides overlap in SVG: every numeral must come
    // after the mark, or the sighting line would strike through the 4.
    const children = [...band.children];
    const markIndex = children.indexOf(mark);
    const firstLabel = children.findIndex((el) => el.tagName.toLowerCase() === "text");
    expect(firstLabel).toBeGreaterThan(markIndex);
  });
});
