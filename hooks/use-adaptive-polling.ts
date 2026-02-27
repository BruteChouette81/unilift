import { useEffect, useRef } from "react";

type AdaptivePollingParams = {
  enabled?: boolean;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
};

type PollCallback = () => Promise<boolean | void> | boolean | void;

export function useAdaptivePolling(
  callback: PollCallback,
  {
    enabled = true,
    initialDelayMs = 2000,
    maxDelayMs = 30000,
    backoffFactor = 1.8,
  }: AdaptivePollingParams = {},
) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = initialDelayMs;

    const run = async () => {
      if (cancelled) return;

      try {
        const hasActivity = await savedCallback.current();
        delay = hasActivity ? initialDelayMs : Math.min(maxDelayMs, Math.floor(delay * backoffFactor));
      } catch {
        delay = Math.min(maxDelayMs, Math.floor(delay * backoffFactor));
      } finally {
        if (!cancelled) {
          timer = setTimeout(run, delay);
        }
      }
    };

    timer = setTimeout(run, delay);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [backoffFactor, enabled, initialDelayMs, maxDelayMs]);
}
