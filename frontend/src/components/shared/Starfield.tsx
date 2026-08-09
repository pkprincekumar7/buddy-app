import { useEffect, useRef } from 'react';

/**
 * Drifting, twinkling starfield on a canvas — the ambient backdrop for the
 * Growth Map. Density scales with viewport area, and the whole field is
 * regenerated on resize so stars never bunch up after an orientation change.
 *
 * Honours prefers-reduced-motion by painting a single static frame instead of
 * animating.
 */
export default function Starfield({ opacity = 0.55 }: { opacity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    interface Star {
      x: number;
      y: number;
      r: number;
      a: number;
      speed: number;
      phase: number;
    }
    let stars: Star[] = [];
    let raf: number | null = null;

    const resize = () => {
      // Cap DPR at 2 — beyond that the extra pixels cost more than they show.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { innerWidth: w, innerHeight: h } = window;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round((w * h) / 7000) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.3 + 0.25,
        a: Math.random() * 0.7 + 0.15,
        speed: Math.random() * 0.9 + 0.25,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    const paint = (animate: boolean) => {
      const { innerWidth: w, innerHeight: h } = window;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        if (animate) {
          s.y -= s.speed * 0.14;
          s.phase += 0.02;
          if (s.y < -2) {
            s.y = h + 2;
            s.x = Math.random() * w;
          }
        }
        const alpha = s.a * (0.65 + 0.35 * Math.sin(s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(190,235,255,${alpha.toFixed(3)})`;
        ctx.fill();
      }
    };

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    resize();
    if (reduceMotion) {
      paint(false);
    } else {
      const tick = () => {
        paint(true);
        raf = requestAnimationFrame(tick);
      };
      tick();
    }

    const onResize = () => {
      resize();
      if (reduceMotion) paint(false);
    };
    window.addEventListener('resize', onResize);

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0"
      style={{ opacity }}
    />
  );
}
