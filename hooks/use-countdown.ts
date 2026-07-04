import { useEffect, useState } from "react";

export function useCountdown(endMs: number) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, endMs - Date.now()),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setRemainingMs(Math.max(0, endMs - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [endMs]);

  const totalSec = Math.floor(remainingMs / 1000);
  return {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
    remainingMs,
    done: remainingMs === 0,
  };
}
