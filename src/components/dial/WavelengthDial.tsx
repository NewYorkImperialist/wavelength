"use client";

import { useCallback, useId, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import {
  KEYBOARD_STEP,
  KEYBOARD_STEP_COARSE,
  KEYBOARD_STEP_FINE,
  RADII,
  VIEWBOX,
} from "@/lib/game/constants";
import { clamp01, describeArcSegment, quantizePosition, type Position } from "@/lib/game/geometry";
import { pointerToPosition } from "@/lib/dial/pointer";

import { CoverScreen } from "./CoverScreen";
import { DialHousing } from "./DialHousing";
import { DialHub, Needle } from "./Needle";
import { SpectrumLabels } from "./SpectrumLabels";
import { TargetWedges } from "./TargetWedges";

export interface WavelengthDialProps {
  leftLabel: string;
  rightLabel: string;
  needlePosition: Position;
  /**
   * Supplied ONLY when the viewer may see the target — the psychic before the
   * reveal, or everyone after it. When null the wedges are not rendered at
   * all, rather than hidden.
   */
  targetCenter: Position | null;
  /** Drives the shutters. */
  screenOpen: boolean;
  /** True only for the player currently holding the dial. */
  interactive: boolean;
  /** Fires continuously while dragging, coalesced to one call per frame. */
  onChange?: (position: Position) => void;
  /** Fires once when a drag or keystroke settles. */
  onCommit?: (position: Position) => void;
  /** Enter or Space. */
  onLock?: () => void;
}

export function WavelengthDial({
  leftLabel,
  rightLabel,
  needlePosition,
  targetCenter,
  screenOpen,
  interactive,
  onChange,
  onCommit,
  onLock,
}: WavelengthDialProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<number | null>(null);
  const latestRef = useRef<Position>(needlePosition);
  const clipId = useId();

  const flush = useCallback(() => {
    frameRef.current = null;
    onChange?.(latestRef.current);
  }, [onChange]);

  const readPointer = useCallback((event: PointerEvent<SVGElement>): Position | null => {
    const svg = svgRef.current;
    if (svg === null) return null;
    return pointerToPosition(event.clientX, event.clientY, svg);
  }, []);

  const handlePointerDown = useCallback(
    (event: PointerEvent<SVGElement>) => {
      if (!interactive) return;
      const next = readPointer(event);
      if (next === null) return;

      event.preventDefault();
      // Capture means the drag survives the pointer leaving the SVG: you can
      // fling past the rim and the needle still tracks the angle.
      event.currentTarget.setPointerCapture(event.pointerId);
      latestRef.current = next;
      onChange?.(next);
    },
    [interactive, onChange, readPointer],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<SVGElement>) => {
      if (!interactive) return;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const next = readPointer(event);
      if (next === null) return;

      latestRef.current = next;
      // Coalesce to one update per frame: pointers fire far faster than the
      // screen refreshes, and the extra calls are pure waste.
      frameRef.current ??= requestAnimationFrame(flush);
    },
    [flush, interactive, readPointer],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<SVGElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      event.currentTarget.releasePointerCapture(event.pointerId);

      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      onChange?.(latestRef.current);
      onCommit?.(latestRef.current);
    },
    [onChange, onCommit],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<SVGGElement>) => {
      if (!interactive) return;

      const step = event.shiftKey ? KEYBOARD_STEP_FINE : KEYBOARD_STEP;
      let next: Position | null = null;

      switch (event.key) {
        case "ArrowRight":
        case "ArrowUp":
          next = needlePosition + step;
          break;
        case "ArrowLeft":
        case "ArrowDown":
          next = needlePosition - step;
          break;
        case "PageUp":
          next = needlePosition + KEYBOARD_STEP_COARSE;
          break;
        case "PageDown":
          next = needlePosition - KEYBOARD_STEP_COARSE;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = 1;
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          onLock?.();
          return;
        default:
          return;
      }

      // Stop PageUp/Home from scrolling the page out from under the dial.
      event.preventDefault();
      const clamped = quantizePosition(clamp01(next));
      latestRef.current = clamped;
      onChange?.(clamped);
      onCommit?.(clamped);
    },
    [interactive, needlePosition, onChange, onCommit, onLock],
  );

  return (
    <svg
      ref={svgRef}
      viewBox={`${VIEWBOX.minX} ${VIEWBOX.minY} ${VIEWBOX.width} ${VIEWBOX.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label={`Wavelength dial: ${leftLabel} to ${rightLabel}`}
      // touch-none stops the browser claiming the gesture for scroll or pinch;
      // without it, dragging on a phone is unusable.
      className="w-full h-auto touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <defs>
        {/* Confines everything to the upper semicircle, so the shutters
            disappear as they swing below the baseline. */}
        <clipPath id={clipId}>
          <path d={describeArcSegment(0, 1, 0, RADII.rimOuter)} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <DialHousing />
        {targetCenter !== null && <TargetWedges center={targetCenter} />}
        <CoverScreen open={screenOpen} />
      </g>

      {/* Outside the clip so the needle's tail can cross the baseline. */}
      <Needle
        position={needlePosition}
        interactive={interactive}
        leftLabel={leftLabel}
        rightLabel={rightLabel}
        onKeyDown={handleKeyDown}
      />
      <DialHub />
      <SpectrumLabels left={leftLabel} right={rightLabel} />
    </svg>
  );
}
