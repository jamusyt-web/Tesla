// The phone check used everywhere: a touch screen or a small one gets the
// cheaper graphics, and the server shows it fewer far-off monsters.
export const isTouch = matchMedia('(pointer: coarse)').matches;
export const isLow = () => isTouch || Math.min(screen.width, screen.height) < 700;
