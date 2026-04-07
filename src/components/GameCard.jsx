import React, { useEffect, useRef, useState } from "react";

export default function GameCard({
  round,
  burstPoint,
  onMultiplierUpdate,
  onBurst,
  onBreakStateChange,
  onRestComplete,
}) {
  const [multiplier, setMultiplier] = useState(1.0);
  const [roundState, setRoundState] = useState("live"); // 'live' | 'burst' | 'rest'
  const [restCountdown, setRestCountdown] = useState(5);
  const [restProgress, setRestProgress] = useState(0);

  const rafRef = useRef(null);
  const restTimerRef = useRef(null);
  const burstTimerRef = useRef(null);
  const roundStateRef = useRef("live");
  const hasBurstRef = useRef(false);

  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (restTimerRef.current) {
      clearInterval(restTimerRef.current);
      restTimerRef.current = null;
    }

    if (burstTimerRef.current) {
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }

    setMultiplier(1.0);
    setRoundState("live");
    roundStateRef.current = "live";
    setRestCountdown(5);
    setRestProgress(0);
    hasBurstRef.current = false;

    // Multiplier is rising -> break is OFF
    if (onBreakStateChange) {
      onBreakStateChange(false);
    }

    const numericBurst = Number(burstPoint);
    const willRun =
      numericBurst != null &&
      Number.isFinite(numericBurst) &&
      numericBurst >= 1;

    if (!willRun) {
      return () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        if (restTimerRef.current) {
          clearInterval(restTimerRef.current);
          restTimerRef.current = null;
        }
        if (burstTimerRef.current) {
          clearTimeout(burstTimerRef.current);
          burstTimerRef.current = null;
        }
      };
    }

    const startTime = performance.now();
    const target = numericBurst;

    const animate = (now) => {
      if (roundStateRef.current !== "live") return;

      const elapsed = now - startTime;
      const t = elapsed / 1000;

      const k = 0.18;
      const raw = 1 + (Math.exp(k * t) - 1);
      const next = Math.min(raw, target);

      setMultiplier(next);

      if (onMultiplierUpdate) {
        onMultiplierUpdate(next);
      }

      if (!hasBurstRef.current && next >= target) {
        hasBurstRef.current = true;
        setRoundState("burst");
        roundStateRef.current = "burst";

        if (onBurst) {
          onBurst(round);
        }

        burstTimerRef.current = setTimeout(() => {
          setRoundState("rest");
          roundStateRef.current = "rest";
          setRestCountdown(5);
          setRestProgress(0);

          // Multiplier stopped -> break is ON
          if (onBreakStateChange) {
            onBreakStateChange(true);
          }

          let remaining = 5;

          const interval = setInterval(() => {
            remaining -= 1;
            setRestCountdown(remaining);
            setRestProgress((5 - remaining) / 5);

            if (remaining <= 0) {
              clearInterval(interval);
              restTimerRef.current = null;

              setMultiplier(1.0);
              setRoundState("live");
              roundStateRef.current = "live";
              setRestProgress(1);

              // Break ends -> multiplier rising again -> break OFF
              if (onBreakStateChange) {
                onBreakStateChange(false);
              }

              if (onRestComplete) {
                onRestComplete();
              }
            }
          }, 1000);

          restTimerRef.current = interval;
        }, 1500);

        return;
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (restTimerRef.current) {
        clearInterval(restTimerRef.current);
        restTimerRef.current = null;
      }
      if (burstTimerRef.current) {
        clearTimeout(burstTimerRef.current);
        burstTimerRef.current = null;
      }
    };
  }, [
    burstPoint,
    round,
    onMultiplierUpdate,
    onBurst,
    onBreakStateChange,
    onRestComplete,
  ]);

  const numMultiplier =
    multiplier === null || multiplier === undefined ? null : Number(multiplier);

  const displayMultiplier =
    numMultiplier === null || numMultiplier === undefined || numMultiplier === 0
      ? "0.00"
      : numMultiplier.toFixed(2);

  return (
    <div className="game-card">
      <div className="game-card__visual">
        <div className="game-card__plane-wrap">
          <div className="game-card__plane">
            <div className="game-card__plane-fuselage" />
            <div className="game-card__plane-wings" />
            <div className="game-card__plane-tail" />
            <div className="game-card__plane-x" />
          </div>
        </div>

        <div className="game-card__rings">
          <div className="game-card__ring game-card__ring--outer" />
          <div className="game-card__ring game-card__ring--middle" />
          <div className="game-card__ring game-card__ring--inner" />

          {roundState === "rest" && (
            <div
              className="game-card__rest-ring"
              style={{ "--rest-progress": restProgress }}
            />
          )}

          <div className="game-card__multiplier">
            {roundState === "rest" ? (
              <>
                <div className="game-card__next-round-label">Next Round In</div>
                <div className="game-card__next-round-time">{restCountdown}s</div>
              </>
            ) : roundState === "burst" ? (
              <div className="game-card__burst-text">BURSTED</div>
            ) : (
              <div className="game-card__multiplier-value">{displayMultiplier}x</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
