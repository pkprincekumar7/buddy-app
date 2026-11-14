import { useState, type CSSProperties } from 'react';

/** The pieces' colours (the prototype's): cyan, gold, ice, cyan-bright, gold. */
const COLORS = ['discover', 'gold', 'world-name', 'orb-sky', 'gold'] as const;
const PIECES = 46;

interface Piece {
  color: string;
  dx: number;
  dy: number;
  turn: number;
  width: number;
  round: boolean;
  delay: number;
  duration: number;
}

/** 46 pieces flung out from the middle, each its own way, pace and spin (the prototype's). */
function makePieces(rand: () => number = Math.random): Piece[] {
  return Array.from({ length: PIECES }, (_, i) => {
    const angle = rand() * Math.PI * 2;
    const reach = 120 + rand() * 260;
    return {
      color: `rgb(var(--kids-${COLORS[i % COLORS.length]}-rgb))`,
      dx: Math.cos(angle) * reach,
      dy: Math.sin(angle) * reach + 120,
      turn: rand() * 720 - 360,
      width: 6 + rand() * 6,
      round: i % 3 === 0,
      delay: 0.5 + rand() * 1.6,
      duration: 1.4 + rand() * 1,
    };
  });
}

/**
 * Confetti (the prototype's): a cyan and a gold ring that grow and fade, and 46 pieces flung out
 * from the middle, once, when it mounts (Discover on opening, a Grow world's report). Fills its
 * nearest positioned box; hidden when the device asks for reduced motion.
 */
export default function Confetti() {
  const [pieces] = useState(() => makePieces());
  return (
    <div className="kids-confetti" aria-hidden="true">
      {[0, 1].map((k) => (
        <span
          key={`ring-${k}`}
          className={k ? 'kids-confetti-ring kids-confetti-ring-gold' : 'kids-confetti-ring'}
          style={{ animationDelay: `${0.35 + k * 0.5}s` }}
        />
      ))}
      {pieces.map((p, i) => (
        <span
          key={i}
          className="kids-confetti-piece"
          style={
            {
              width: p.width,
              height: p.round ? p.width : p.width * 0.45,
              borderRadius: p.round ? '50%' : 2,
              background: p.color,
              boxShadow: `0 0 6px ${p.color}`,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--r': `${p.turn}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
