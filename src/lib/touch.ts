/** Matches touch-first screens: phones, iPads and the iPhone Duo at any width. */
export const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";
/** Matches a mouse/trackpad device; the inverse of TOUCH_QUERY for gating desktop-only behaviour. */
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
