// Cross-platform haptic feedback for web.
//
// Android Chrome: uses the Web Vibration API (navigator.vibrate).
// iOS Safari:    no official vibrate API — falls back to the "<input
//                type='checkbox' switch>" trick, where programmatically
//                toggling a switch input triggers a subtle selection
//                haptic on iOS 17.4+ (especially in standalone PWAs).
// Anywhere else: no-op.
//
// Three semantic intents. Call these instead of raw vibrate(N).

type Intent = "tick" | "press" | "success";

const VIBRATE_PATTERNS: Record<Intent, number | number[]> = {
  tick: 6,          // light selection feedback
  press: 12,        // medium "you've held it"
  success: [30, 40, 18], // thunk-pause-tick — confirmation
};

let iosSwitch: HTMLInputElement | null = null;
let iosLabel: HTMLLabelElement | null = null;

function ensureIosNodes(): { input: HTMLInputElement; label: HTMLLabelElement } | null {
  if (typeof document === "undefined") return null;
  if (iosSwitch && iosLabel) return { input: iosSwitch, label: iosLabel };
  try {
    const input = document.createElement("input");
    input.type = "checkbox";
    // The non-standard `switch` attribute is what iOS uses to render
    // the toggle UI — and toggling it programmatically fires the haptic.
    input.setAttribute("switch", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    input.style.left = "-9999px";
    input.id = "kaizen-haptic-switch";

    const label = document.createElement("label");
    label.htmlFor = "kaizen-haptic-switch";
    label.style.position = "fixed";
    label.style.opacity = "0";
    label.style.pointerEvents = "none";
    label.style.left = "-9999px";

    document.body.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = input;
    iosLabel = label;
    return { input, label };
  } catch {
    return null;
  }
}

function tryNavigatorVibrate(pattern: number | number[]): boolean {
  if (typeof navigator === "undefined") return false;
  // Use the standard typed signature — Vibration API in TS expects VibratePattern.
  if (typeof navigator.vibrate !== "function") return false;
  try {
    const arg: number | number[] = Array.isArray(pattern) ? pattern : pattern;
    return navigator.vibrate(arg) ?? true;
  } catch {
    return false;
  }
}

function tryIosSwitchHaptic(): boolean {
  const nodes = ensureIosNodes();
  if (!nodes) return false;
  try {
    // Toggling via .click() on the label is what triggers the selection haptic.
    nodes.label.click();
    return true;
  } catch {
    return false;
  }
}

export function haptic(intent: Intent): void {
  // Android & co. first — the Web Vibration API is more expressive.
  const vibrated = tryNavigatorVibrate(VIBRATE_PATTERNS[intent]);
  if (vibrated) return;
  // iOS Safari fallback (one tick regardless of intent — the trick can't
  // distinguish tick vs success).
  tryIosSwitchHaptic();
}
