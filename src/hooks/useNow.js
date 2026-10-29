import { useEffect, useState } from 'react';

// Milliseconds from `from` to the next local midnight. DST-safe because the
// target is a real local date, not a fixed 24h offset.
export function msUntilMidnight(from = new Date()) {
  const next = new Date(from);
  next.setHours(24, 0, 0, 0);
  return Math.max(1000, next.getTime() - new Date(from).getTime());
}

// A clock that ticks at local midnight, and whenever a backgrounded tab comes
// back. Without it, a page left open overnight would still call yesterday
// "today", keep expired events on the board and print a stale "Next up" date —
// the date only moved when the event list happened to change.
export function useNow() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer;

    const tick = () => {
      const current = new Date();
      setNow(current);
      clearTimeout(timer);
      timer = setTimeout(tick, msUntilMidnight(current));
    };

    // Arm the timer for the coming midnight as soon as the page mounts.
    timer = setTimeout(tick, msUntilMidnight(new Date()));

    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return now;
}
