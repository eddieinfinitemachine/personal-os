/** Matches touch-first screens: phones, iPads and the iPhone Duo at any width. */
export const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";
/** Matches a mouse/trackpad device; the inverse of TOUCH_QUERY for gating desktop-only behaviour. */
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
/** The desktop layout: a mouse/trackpad on a tablet-or-wider screen, or any screen from lg up.
 *  A touch screen below lg (every iPhone Duo pose, iPad mini portrait) gets the phone chrome.
 *  Keep in sync with the `md`/`max-md` custom variants in src/app/globals.css. */
export const DESKTOP_QUERY = "((min-width: 768px) and (hover: hover) and (pointer: fine)), (min-width: 1024px)";
