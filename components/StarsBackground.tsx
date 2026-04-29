import { useEffect, useRef } from 'react';

/** Twinkling starfield — matches `preview.html` #stars canvas. */
export default function StarsBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    type Star = { x: number; y: number; r: number; a: number; da: number };
    let stars: Star[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const spawn = () => {
      stars = Array.from({ length: 200 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.1 + 0.2,
        a: Math.random() * 0.55 + 0.08,
        da: (Math.random() - 0.5) * 0.008,
      }));
    };

    let stopped = false;
    const draw = () => {
      if (stopped) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        s.a = Math.max(0.05, Math.min(0.7, s.a + s.da));
        if (Math.random() < 0.005) s.da *= -1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.a.toFixed(2)})`;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    };

    resize();
    spawn();
    requestAnimationFrame(draw);
    const onResize = () => {
      resize();
      spawn();
    };
    window.addEventListener('resize', onResize);

    return () => {
      stopped = true;
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="stars"
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden
    />
  );
}
