/**
 * Real touchscreens report several pixels of jitter even for a finger the user is deliberately
 * holding still -- contact-area/pressure changes shift the reported centroid, and a slow drift
 * over a few hundred milliseconds is normal. A tolerance has to allow for "stayed roughly in one
 * place", not "stayed on one exact pixel" (which no real touch input can do), while still being
 * tight enough to distinguish a genuine pan/drag/swipe from that noise. This value is shared by
 * every touch gesture in the app that needs a tap/hold-vs-drag distinction, so they stay
 * consistent with each other.
 */
export const TOUCH_MOVE_SLOP = 20;
