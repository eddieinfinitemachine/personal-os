import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExerciseFigure, propForEquipment } from "./exercise-figure";
import { MOVEMENT_PATTERNS } from "@/lib/workout";

describe("ExerciseFigure", () => {
  it("renders a SMIL loop for every pattern with finite, closed value series", () => {
    for (const pattern of MOVEMENT_PATTERNS) {
      const html = renderToStaticMarkup(<ExerciseFigure pattern={pattern} prop="dumbbell" />);
      expect(html).toContain('viewBox="0 0 200 200"');
      const animates = [...html.matchAll(/<animate(?:Transform)? [^>]*values="([^"]+)"[^>]*dur="(\d+)ms"/g)];
      expect(animates.length, pattern).toBeGreaterThanOrEqual(38); // 9 segments × 4 + head cx/cy
      for (const [, values] of animates) {
        const parts = values.split(";");
        expect(parts.length).toBe(25); // 24 samples + the first repeated to close the loop
        expect(parts[0]).toBe(parts[parts.length - 1]);
        for (const p of parts) for (const n of p.trim().split(" ")) expect(Number.isFinite(Number(n))).toBe(true);
      }
      // Grounded: nothing renders below the ground line (y > 184 + stroke).
      const ys = [...html.matchAll(/ y[12]="([\d.]+)"/g)].map((m) => Number(m[1]));
      expect(Math.max(...ys)).toBeLessThanOrEqual(184);
    }
  });

  it("renders a static pose when frozen or not playing", () => {
    const frozen = renderToStaticMarkup(<ExerciseFigure pattern="squat" frame={1} />);
    expect(frozen).not.toContain("<animate");
    const paused = renderToStaticMarkup(<ExerciseFigure pattern="squat" playing={false} />);
    expect(paused).not.toContain("<animate");
  });

  it("only draws a hand-held prop where the pose can hold one", () => {
    expect(renderToStaticMarkup(<ExerciseFigure pattern="plank" prop="dumbbell" frame={0} />)).not.toContain("<rect");
    expect(renderToStaticMarkup(<ExerciseFigure pattern="curl" prop="dumbbell" frame={0} />)).toContain("<rect");
    expect(renderToStaticMarkup(<ExerciseFigure pattern="curl" prop="none" frame={0} />)).not.toContain("<rect");
    expect(renderToStaticMarkup(<ExerciseFigure pattern="pull-vertical" prop="none" frame={0} />)).toContain('x1="-40"');
  });

  it("maps equipment text to a prop", () => {
    expect(propForEquipment("kettlebell", "1×16 kg kettlebell")).toBe("dumbbell");
    expect(propForEquipment("barbell", "95 lb")).toBe("bar");
    expect(propForEquipment("pull-up bar", "bodyweight")).toBe("bar");
    expect(propForEquipment("bodyweight", "bodyweight")).toBe("none");
  });
});
