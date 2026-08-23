import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useTts } from '@/lib/TtsContext';
import { api } from '@/api/client';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import Spinner from '@/components/shared/Spinner';
import {
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
} from '@/components/shared/PersonalityAnalysis';
import { sanitizeViewModelAvatars, stripViewModelImages } from '@/lib/avatarUtils';
import { maybeClampStoredPersonalityDescription } from '@/lib/personalizedDescriptionOneLiner';
import { personalityLlmSchema } from '@/lib/llmSchemas';
import { buildPersonalityAnalysisPrompt } from '@/lib/prompts';
import { useJob } from '@/hooks/useJob';
import { useMediaQuery } from '@/hooks/use-mobile';
import { useStartOver } from '@/hooks/useStartOver';
import { cn } from '@/lib/utils';
import StageSplash from '@/components/shared/StageSplash';
import { ConfirmModal as StartOverConfirmModal } from '@/components/shared/StartOverButton';
import { useAmbientAudio } from '@/lib/AmbientAudioContext';

type Phase = 1 | 2;

// The circle the hub's glowing spoke + traveling dots point to — the next
// step in the Discover → Grow → Transform → Release → Connect flow the user
// hasn't reached yet, so the animation always leads toward the frontier
// circle instead of staying pinned on Discover. null once every step —
// including Connect — has been visited, so nothing is pointed at.
type ActiveDimension = 'discover' | 'grow' | 'transform' | 'release' | 'connect' | null;

// ── Phase 1: Buddy 360 Orb ────────────────────────────────────────────────────

function BuddyOrbScreen({
  childName,
  isAnalyzing,
  onTap,
}: {
  childName: string;
  isAnalyzing: boolean;
  onTap: () => void;
}) {
  return (
    <div className="relative" style={{ minHeight: '100vh', width: '100%' }}>
      {/* Text above — heading bottom pinned 32px above orb top */}
      <div
        className="absolute left-0 right-0 px-6 text-center"
        style={{
          top: 'calc(50vh - 64px - clamp(100px, 36vmin, 150px) - 32px)',
          transform: 'translateY(-100%)',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          {isAnalyzing ? (
            <div className="flex flex-col items-center gap-4">
              <h1
                className="font-orbitron text-white"
                style={{
                  fontWeight: 700,
                  fontSize: 'clamp(28px, 4vw, 42px)',
                  lineHeight: 1.25,
                  maxWidth: 640,
                  textWrap: 'pretty',
                }}
              >
                Preparing{' '}
                <span style={{ color: 'rgb(var(--constellation-cyan-rgb))' }}>
                  {childName}&apos;s
                </span>{' '}
                profile
              </h1>
              <div className="flex gap-2">
                {[0, 0.15, 0.3].map((delay, i) => (
                  <motion.span
                    key={i}
                    animate={{ y: [0, -7, 0] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay, ease: 'easeInOut' }}
                    className="block h-2 w-2 rounded-full"
                    style={{ background: 'rgb(var(--constellation-cyan-bright-rgb))' }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <h1
              className="font-orbitron text-white"
              style={{
                fontWeight: 900,
                fontSize: 'clamp(28px, 4vw, 42px)',
                lineHeight: 1.25,
                maxWidth: 640,
                textWrap: 'pretty',
              }}
            >
              Click here to begin your child&apos;s{' '}
              <span style={{ color: 'rgb(var(--constellation-cyan-rgb))' }}>transformation</span>
            </h1>
          )}
        </motion.div>
      </div>

      {/* Orb centered at device vertical center (50vh) */}
      <div
        className="absolute"
        style={{
          left: '50%',
          top: 'calc(50vh - 64px - clamp(100px, 36vmin, 150px))',
          transform: 'translateX(-50%)',
        }}
      >
        <motion.button
          onClick={isAnalyzing ? undefined : onTap}
          whileTap={isAnalyzing ? undefined : { scale: 0.94 }}
          className={cn(
            'relative focus:outline-none',
            isAnalyzing ? 'cursor-default' : 'cursor-pointer',
          )}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <svg
            viewBox="0 0 350 350"
            xmlns="http://www.w3.org/2000/svg"
            style={{
              display: 'block',
              overflow: 'visible',
              width: 'clamp(200px, 72vmin, 300px)',
              height: 'clamp(200px, 72vmin, 300px)',
            }}
          >
            <style>{`
            @keyframes buddySpin {
              from { transform: rotate(0deg); }
              to   { transform: rotate(360deg); }
            }
            @keyframes buddySpinRev {
              from { transform: rotate(0deg); }
              to   { transform: rotate(-360deg); }
            }
            @keyframes buddyGoldBreathe {
              0%, 100% { transform: scale(1); }
              50%       { transform: scale(1.04); }
            }
            @keyframes buddyGoldPulse {
              0%, 100% { transform: scale(1); }
              50%       { transform: scale(1.10); }
            }
          `}</style>

            <defs>
              {/* Warm gold → cyan → deep teal gradient for inner sphere */}
              <radialGradient id="buddyCoreGrad" cx="50%" cy="42%" r="60%">
                <stop offset="0%" stopColor="rgb(var(--constellation-gold-cream-rgb))" />
                <stop offset="22%" stopColor="rgb(var(--constellation-gold-bright-rgb))" />
                <stop offset="52%" stopColor="rgb(var(--constellation-cyan-rgb))" />
                <stop offset="100%" stopColor="rgb(var(--constellation-cyan-deep-rgb))" />
              </radialGradient>
              {/* Soft gold halo between rings */}
              <radialGradient id="buddyGoldHalo" cx="50%" cy="50%" r="50%">
                <stop offset="55%" stopColor="rgb(var(--constellation-gold-glow-rgb) / 0)" />
                <stop offset="82%" stopColor="rgb(var(--constellation-gold-glow-rgb) / 0.30)" />
                <stop offset="100%" stopColor="rgb(var(--constellation-gold-glow-rgb) / 0)" />
              </radialGradient>
            </defs>

            {/* ① Outer dotted ring — rotates clockwise 18s */}
            <g
              style={{ animation: 'buddySpin 18s linear infinite', transformOrigin: '175px 175px' }}
            >
              <circle
                cx="175"
                cy="175"
                r="150"
                fill="none"
                stroke="rgb(var(--constellation-cyan-bright-rgb))"
                strokeWidth="3"
                strokeDasharray="4 8"
                opacity="0.65"
              />
            </g>

            {/* ② Inner segmented ring — counter-rotates 26s */}
            <g
              style={{
                animation: 'buddySpinRev 26s linear infinite',
                transformOrigin: '175px 175px',
              }}
            >
              {/* Dark base ring */}
              <circle
                cx="175"
                cy="175"
                r="124"
                fill="none"
                stroke="rgb(var(--constellation-teal-deep-rgb))"
                strokeWidth="11"
                opacity="0.55"
              />
              {/* Cyan segments on top */}
              <circle
                cx="175"
                cy="175"
                r="124"
                fill="none"
                stroke="rgb(var(--constellation-cyan-bright-rgb))"
                strokeWidth="11"
                strokeDasharray="20 12 46 12 20 70"
                opacity="0.9"
              />
            </g>

            {/* ③ Thin separator ring */}
            <circle
              cx="175"
              cy="175"
              r="98"
              fill="none"
              stroke="rgb(var(--constellation-slate-navy-rgb))"
              strokeWidth="1"
              opacity="0.5"
            />

            {/* ④ Gold halo atmosphere */}
            <circle
              cx="175"
              cy="175"
              r="101"
              fill="url(#buddyGoldHalo)"
              style={{
                animation: 'buddyGoldPulse 3.6s ease-in-out infinite',
                transformOrigin: '175px 175px',
              }}
            />

            {/* ⑤ Inner sphere — breathing */}
            <circle
              cx="175"
              cy="175"
              r="63"
              fill="url(#buddyCoreGrad)"
              style={{
                animation: 'buddyGoldBreathe 3.2s ease-in-out infinite',
                transformOrigin: '175px 175px',
              }}
            />

            {/* ⑥ Gold accent dashes — fast spin 6s */}
            <g
              style={{ animation: 'buddySpin 6s linear infinite', transformOrigin: '175px 175px' }}
            >
              <circle
                cx="175"
                cy="175"
                r="76"
                fill="none"
                stroke="rgb(var(--constellation-gold-bright-rgb))"
                strokeWidth="1.6"
                strokeDasharray="14 206"
                opacity="0.85"
                style={{ filter: 'drop-shadow(0 0 6px rgb(var(--constellation-gold-glow2-rgb) / 0.9))' }}
              />
            </g>

            {/* ⑦ Lightning bolt (polygon from clip-path in HTML, converted to SVG path) */}
            <path
              d="M175 152.5 L155 185 L170 185 L160 210 L195 172.5 L177.5 172.5 Z"
              fill="rgb(var(--constellation-navy-rgb))"
              opacity="0.9"
            />
          </svg>
        </motion.button>
      </div>

      {/* Text below orb — 32px gap below orb bottom */}
      {!isAnalyzing && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.5 }}
          style={{
            position: 'absolute',
            left: '50%',
            top: 'calc(50vh - 64px + clamp(100px, 36vmin, 150px) + 32px)',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            fontFamily: 'sans-serif',
            fontWeight: 700,
            fontSize: '12.5px',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'rgb(var(--constellation-slate-dark-rgb))',
          }}
        >
          Tap the core to enter the zone
        </motion.p>
      )}
    </div>
  );
}

// ── Phase 2: Buddy 360 Nav (matches HTML exactly) ────────────────────────────

const NODE_STYLE = {
  position: 'absolute' as const,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 92,
  height: 92,
  transform: 'translate(-50%, -50%)',
  zIndex: 2,
};

const ACTIVE_INNER: React.CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: '50%',
  background:
    'radial-gradient(circle at 38% 32%,rgb(var(--constellation-cyan-pale-rgb)),rgb(var(--constellation-cyan-rgb)) 42%,rgb(var(--constellation-cyan-deep-rgb)) 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  position: 'relative',
  zIndex: 2,
};

const INACTIVE_INNER: React.CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: '50%',
  background: 'radial-gradient(circle at 38% 32%,#cbd6dd,rgb(var(--constellation-slate-deep-rgb)) 55%,#2a333c 100%)',
  boxShadow: '0 0 10px rgb(var(--constellation-slate-deep-rgb) / .4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'not-allowed',
  position: 'relative',
  zIndex: 2,
};

const NODE_LABEL: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: '50%',
  transform: 'translateX(-50%)',
  marginTop: 10,
  fontWeight: 700,
  fontSize: 14,
  color: 'rgb(var(--constellation-text-frost-rgb))',
  whiteSpace: 'nowrap',
};

// A dimension circle that is either fully active (cyan, pulsing ring, clickable) or
// locked (dim slate, static ring, non-interactive) depending on journey progress.
function DimensionNode({
  position,
  animationDelay,
  onClick,
  locked,
  highlighted,
  iconPaths,
  label,
}: {
  position: React.CSSProperties;
  animationDelay: string;
  onClick: () => void;
  locked: boolean;
  // True when this is the frontier circle the hub's spoke/dots point to —
  // gets the faster double-ring pulse + animated glow instead of the
  // standard single-ring look every other unlocked circle uses.
  highlighted: boolean;
  iconPaths: React.ReactNode;
  label: string;
}) {
  return (
    <div
      role="button"
      tabIndex={locked ? -1 : 0}
      aria-disabled={locked}
      onClick={locked ? undefined : onClick}
      onKeyDown={
        locked
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
      }
      style={{
        ...NODE_STYLE,
        ...position,
        animation: `nodeIn .75s cubic-bezier(.16,1,.3,1) ${animationDelay} both`,
        cursor: locked ? 'not-allowed' : 'pointer',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: locked
            ? '1.5px solid rgb(var(--constellation-slate-deep-rgb))'
            : '1.5px solid rgb(var(--constellation-cyan-bright-rgb))',
          opacity: locked ? 0.4 : 0.5,
        }}
      />
      {!locked && highlighted && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid rgb(var(--constellation-cyan-paler-rgb))',
            animation: 'nodePulse 1.7s ease-out infinite',
          }}
        />
      )}
      {!locked && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '1.5px solid rgb(var(--constellation-cyan-rgb))',
            animation: highlighted
              ? 'nodePulse 1.7s ease-out .85s infinite'
              : 'nodePulse 2.6s ease-out infinite',
          }}
        />
      )}
      <div
        style={
          locked
            ? INACTIVE_INNER
            : highlighted
              ? { ...ACTIVE_INNER, animation: 'ctaGlow 1.7s ease-in-out infinite' }
              : { ...ACTIVE_INNER, boxShadow: '0 0 20px rgb(var(--constellation-cyan-rgb) / .5)' }
        }
      >
        <svg
          viewBox="0 0 24 24"
          style={{
            width: 23,
            height: 23,
            stroke: locked ? '#1b232b' : 'rgb(var(--constellation-navy-rgb))',
            fill: 'none',
            strokeWidth: 2.2,
          }}
        >
          {iconPaths}
        </svg>
      </div>
      <div
        className="font-rajdhani"
        style={{
          ...NODE_LABEL,
          ...(locked ? { color: 'rgb(var(--constellation-slate-dark-rgb))' } : {}),
        }}
      >
        {label}
      </div>
    </div>
  );
}

function DimensionCirclesScreen({
  onConnect,
  onDiscover,
  onGoHome,
  onGrow,
  onTransform,
  onRelease,
  onStartAgain,
  enabled,
  current,
}: {
  childName: string;
  mergedData: Record<string, unknown>;
  onConnect: () => void;
  onDiscover: () => void;
  onGoHome: () => void;
  onGrow: () => void;
  onTransform: () => void;
  onRelease: () => void;
  onStartAgain: () => void;
  enabled: {
    grow: boolean;
    transform: boolean;
    release: boolean;
    connect: boolean;
  };
  current: ActiveDimension;
}) {
  const ringAreaRef = useRef<HTMLDivElement>(null);
  const [ringScale, setRingScale] = useState(1);
  const isMobile = useMediaQuery('(max-width: 639px)');

  // Exact match to HTML's watchRing: scale ring to fit available space.
  // Depends on isMobile (from the shared media-query hook) rather than
  // re-deriving it from window.innerWidth here, so this effect and the
  // breakpoint state can't disagree with each other or with any other
  // consumer of the same breakpoint elsewhere in the app.
  useEffect(() => {
    const measure = () => {
      const el = ringAreaRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const s = isMobile
        ? Math.min(r.width / 488, r.height / 560, 1)
        : Math.min(r.width / 730, r.height / 730, 1);
      setRingScale((prev) => (Math.abs(s - prev) > 0.005 ? s : prev));
    };
    measure();
    const id = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [isMobile]);

  const SK = isMobile ? 'spokeDrawSm' : 'spokeDraw';
  const SD = isMobile ? '200' : '260';
  const SP = isMobile
    ? {
        connect: 'M350 350 L177 250',
        transform: 'M350 350 L523 250',
        release: 'M350 350 L523 450',
        grow: 'M350 350 L177 450',
        startAgain: 'M350 350 L350 550',
        discover: 'M350 350 L350 150',
      }
    : {
        connect: 'M350 350 L125 220',
        transform: 'M350 350 L575 220',
        release: 'M350 350 L575 480',
        grow: 'M350 350 L125 480',
        startAgain: 'M350 350 L350 610',
        discover: 'M350 350 L350 90',
      };
  const NP = isMobile
    ? {
        connect: { left: '25.27%', top: '35.71%' },
        discover: { left: '50%', top: '21.43%' },
        transform: { left: '74.73%', top: '35.71%' },
        release: { left: '74.73%', top: '64.29%' },
        grow: { left: '25.27%', top: '64.29%' },
        startAgain: { left: '50%', top: '78.57%' },
      }
    : {
        connect: { left: '17.86%', top: '31.43%' },
        discover: { left: '50%', top: '12.86%' },
        transform: { left: '82.14%', top: '31.43%' },
        release: { left: '82.14%', top: '68.57%' },
        grow: { left: '17.86%', top: '68.57%' },
        startAgain: { left: '50%', top: '87.14%' },
      };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: '100vh',
        padding: '0 0 18px',
        transformOrigin: '50% 50%',
        animation: 'scopeFocus 2.4s cubic-bezier(.22,.9,.25,1) both',
        width: '100vw',
        marginLeft: 'calc(50% - 50vw)',
      }}
    >
      <style>{`
        @keyframes tagBob {
          0%,100% { transform: translate(-50%,-118%); }
          50%      { transform: translate(-50%,-118%) translateY(-4px); }
        }
        @keyframes nodePulse {
          0%   { transform: scale(.85); opacity: .7; }
          100% { transform: scale(1.35); opacity: 0; }
        }
        @keyframes spokeDraw {
          from { stroke-dashoffset: 260; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes spokeDrawSm {
          from { stroke-dashoffset: 200; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes lineGlow {
          0%,100% { opacity:.45; filter: drop-shadow(0 0 3px rgb(var(--constellation-cyan-rgb) / .75)); }
          50%     { opacity:.85; filter: drop-shadow(0 0 8px rgb(var(--constellation-cyan-rgb) / 1)); }
        }
        @keyframes hubIn {
          0%   { opacity: 0; transform: translate(-50%,-50%) scale(.1) rotate(-90deg); }
          100% { opacity: 1; transform: translate(-50%,-50%) scale(1)   rotate(0deg); }
        }
        @keyframes nodeIn {
          0%   { opacity: 0; transform: translate(-50%,-50%) scale(.2); }
          100% { opacity: 1; transform: translate(-50%,-50%) scale(1); }
        }
        @keyframes scopeFocus {
          0%   { opacity:0; transform:scale(1.14); filter:blur(9px); }
          45%  { opacity:1; }
          100% { opacity:1; transform:scale(1);    filter:blur(0px); }
        }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
        @keyframes buddySpin    { to { transform: rotate(360deg); } }
        @keyframes buddySpinRev { to { transform: rotate(-360deg); } }
        @keyframes buddyGoldBreathe {
          0%,100% { filter: drop-shadow(0 0 14px rgb(var(--constellation-gold-glow-rgb) / .65)) drop-shadow(0 0 30px rgb(var(--constellation-cyan-rgb) / .45)); }
          50%     { filter: drop-shadow(0 0 26px rgb(var(--constellation-gold-glow2-rgb) / .95)) drop-shadow(0 0 54px rgb(var(--constellation-cyan-rgb) / .55)); }
        }
        @keyframes buddyGoldPulse {
          0%,100% { opacity: .55; }
          50%     { opacity: 1; }
        }
        @keyframes ctaGlow {
          0%,100% { box-shadow: 0 0 22px rgb(var(--constellation-cyan-rgb) / .9),0 0 46px rgb(var(--constellation-cyan-bright-rgb) / .55); }
          50%     { box-shadow: 0 0 36px rgb(var(--constellation-cyan-rgb) / 1),0 0 74px rgb(var(--constellation-cyan-bright-rgb) / .9); }
        }
      `}</style>

      {/* Ring area */}
      <div ref={ringAreaRef} style={{ flex: 1, minHeight: 0, width: '100%', position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 'calc(50vh - 64px)',
            width: 700,
            height: 700,
            transform: `translate(-50%, -50%) scale(${ringScale})`,
            zIndex: 1,
          }}
        >
          {/* SVG spokes */}
          <svg
            viewBox="0 0 700 700"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              overflow: 'visible',
            }}
          >
            {current && (
              <defs>
                <path id="p-hub-disc" d={SP[current]} />
              </defs>
            )}
            <path
              d={SP.connect}
              fill="none"
              stroke="rgb(var(--constellation-cyan-bright-rgb))"
              strokeWidth={current === 'connect' ? 3.4 : 1.6}
              strokeDasharray={SD}
              style={
                current === 'connect'
                  ? { animation: `${SK} .8s ease .35s both, lineGlow 3.4s ease-in-out 1.1s infinite` }
                  : { opacity: 0.4, animation: `${SK} .8s ease .35s both` }
              }
            />
            <path
              d={SP.transform}
              fill="none"
              stroke="rgb(var(--constellation-cyan-bright-rgb))"
              strokeWidth={current === 'transform' ? 3.4 : 1.6}
              strokeDasharray={SD}
              style={
                current === 'transform'
                  ? { animation: `${SK} .8s ease .45s both, lineGlow 3.4s ease-in-out 1.1s infinite` }
                  : { opacity: 0.4, animation: `${SK} .8s ease .45s both` }
              }
            />
            <path
              d={SP.release}
              fill="none"
              stroke="rgb(var(--constellation-cyan-bright-rgb))"
              strokeWidth={current === 'release' ? 3.4 : 1.6}
              strokeDasharray={SD}
              style={
                current === 'release'
                  ? { animation: `${SK} .8s ease .55s both, lineGlow 3.4s ease-in-out 1.1s infinite` }
                  : { opacity: 0.4, animation: `${SK} .8s ease .55s both` }
              }
            />
            <path
              d={SP.grow}
              fill="none"
              stroke="rgb(var(--constellation-cyan-bright-rgb))"
              strokeWidth={current === 'grow' ? 3.4 : 1.6}
              strokeDasharray={SD}
              style={
                current === 'grow'
                  ? { animation: `${SK} .8s ease .5s both, lineGlow 3.4s ease-in-out 1.1s infinite` }
                  : { opacity: 0.4, animation: `${SK} .8s ease .5s both` }
              }
            />
            <path
              d={SP.startAgain}
              fill="none"
              stroke="rgb(var(--constellation-slate-deep-rgb))"
              strokeWidth="1.1"
              strokeDasharray={SD}
              style={{ opacity: 0.22, animation: `${SK} .8s ease .6s both` }}
            />
            <path
              d={SP.discover}
              fill="none"
              stroke="rgb(var(--constellation-cyan-bright-rgb))"
              strokeWidth={current === 'discover' ? 3.4 : 1.6}
              strokeDasharray={SD}
              style={
                current === 'discover'
                  ? { animation: `${SK} .8s ease .3s both, lineGlow 3.4s ease-in-out 1.1s infinite` }
                  : { opacity: 0.4, animation: `${SK} .8s ease .3s both` }
              }
            />
            {current && (
              <>
                <circle
                  r="3.2"
                  fill="rgb(var(--constellation-cyan-pale-rgb))"
                  style={{ filter: 'drop-shadow(0 0 4px rgb(var(--constellation-cyan-rgb) / 1))' }}
                >
                  <animateMotion dur="1.7s" repeatCount="indefinite" begin="1.2s">
                    <mpath href="#p-hub-disc" />
                  </animateMotion>
                </circle>
                <circle
                  r="2.8"
                  fill="rgb(var(--constellation-cyan-pale-rgb))"
                  style={{ filter: 'drop-shadow(0 0 4px rgb(var(--constellation-cyan-rgb) / 1))' }}
                >
                  <animateMotion dur="1.7s" repeatCount="indefinite" begin="2.05s">
                    <mpath href="#p-hub-disc" />
                  </animateMotion>
                </circle>
              </>
            )}
          </svg>

          {/* Center Hub */}
          <div
            onClick={onGoHome}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 190,
              height: 190,
              transform: 'translate(-50%,-50%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 3,
              cursor: 'pointer',
              animation: 'hubIn .95s cubic-bezier(.16,1,.3,1) both',
            }}
          >
            <svg
              viewBox="0 0 190 190"
              width="190"
              height="190"
              style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
            >
              <defs>
                <path id="hubTextPath" d="M95,49 A46,46 0 1,1 94.9,49" />
                <radialGradient id="coreGradHub" cx="50%" cy="42%" r="60%">
                  <stop offset="0%" stopColor="rgb(var(--constellation-gold-cream-rgb))" />
                  <stop offset="22%" stopColor="rgb(var(--constellation-gold-bright-rgb))" />
                  <stop offset="52%" stopColor="rgb(var(--constellation-cyan-rgb))" />
                  <stop offset="100%" stopColor="rgb(var(--constellation-cyan-deep-rgb))" />
                </radialGradient>
                <radialGradient id="goldHaloHub" cx="50%" cy="50%" r="50%">
                  <stop offset="55%" stopColor="rgb(var(--constellation-gold-glow-rgb) / 0)" />
                  <stop offset="82%" stopColor="rgb(var(--constellation-gold-glow-rgb) / 0.30)" />
                  <stop offset="100%" stopColor="rgb(var(--constellation-gold-glow-rgb) / 0)" />
                </radialGradient>
              </defs>
              <g
                style={{ animation: 'buddySpin 18s linear infinite', transformOrigin: '95px 95px' }}
              >
                <circle
                  cx="95"
                  cy="95"
                  r="86"
                  fill="none"
                  stroke="rgb(var(--constellation-cyan-bright-rgb))"
                  strokeWidth="2.4"
                  strokeDasharray="3.5 6.5"
                  opacity="0.65"
                />
              </g>
              <g
                style={{
                  animation: 'buddySpinRev 26s linear infinite',
                  transformOrigin: '95px 95px',
                }}
              >
                <circle
                  cx="95"
                  cy="95"
                  r="71"
                  fill="none"
                  stroke="rgb(var(--constellation-teal-deep-rgb))"
                  strokeWidth="8"
                  opacity="0.55"
                />
                <circle
                  cx="95"
                  cy="95"
                  r="71"
                  fill="none"
                  stroke="rgb(var(--constellation-cyan-bright-rgb))"
                  strokeWidth="8"
                  strokeDasharray="13 8 30 8 13 46"
                  opacity="0.9"
                />
              </g>
              <circle
                cx="95"
                cy="95"
                r="56"
                fill="none"
                stroke="rgb(var(--constellation-slate-navy-rgb))"
                strokeWidth="1"
                opacity="0.5"
              />
              <circle
                cx="95"
                cy="95"
                r="58"
                fill="url(#goldHaloHub)"
                style={{
                  animation: 'buddyGoldPulse 3.6s ease-in-out infinite',
                  transformOrigin: '95px 95px',
                }}
              />
              <circle
                cx="95"
                cy="95"
                r="36"
                fill="url(#coreGradHub)"
                style={{
                  animation: 'buddyGoldBreathe 3.2s ease-in-out infinite',
                  transformOrigin: '95px 95px',
                }}
              />
              <circle
                cx="95"
                cy="95"
                r="43"
                fill="none"
                stroke="rgb(var(--constellation-gold-bright-rgb))"
                strokeWidth="1.2"
                strokeDasharray="8 118"
                opacity=".85"
                style={{
                  animation: 'buddySpin 6s linear infinite',
                  transformOrigin: '95px 95px',
                  filter: 'drop-shadow(0 0 5px rgb(var(--constellation-gold-glow2-rgb) / .9))',
                }}
              />
              <path
                d="M95 80 L83 100 L92 100 L86 116 L108 92 L97 92 Z"
                fill="rgb(var(--constellation-navy-rgb))"
                opacity="0.9"
              />
              <g
                style={{ animation: 'buddySpin 32s linear infinite', transformOrigin: '95px 95px' }}
              >
                <text
                  className="font-rajdhani"
                  style={{
                    fontWeight: 700,
                    fontSize: '8.5px',
                    letterSpacing: '.13em',
                    fill: 'rgb(var(--constellation-cyan-rgb))',
                  }}
                >
                  <textPath href="#hubTextPath" startOffset="0%">
                    HOME&nbsp;&nbsp;•&nbsp;&nbsp;HOME&nbsp;&nbsp;•&nbsp;&nbsp;HOME&nbsp;&nbsp;•&nbsp;&nbsp;HOME&nbsp;&nbsp;•&nbsp;&nbsp;HOME&nbsp;&nbsp;•&nbsp;&nbsp;HOME&nbsp;&nbsp;•&nbsp;&nbsp;
                  </textPath>
                </text>
              </g>
            </svg>
          </div>

          {/* Connect — top-left */}
          <DimensionNode
            position={NP.connect}
            animationDelay=".55s"
            onClick={onConnect}
            locked={!enabled.connect}
            highlighted={current === 'connect'}
            label="Connect"
            iconPaths={<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />}
          />

          {/* Discover — top-center (CTA) */}
          <div
            onClick={onDiscover}
            style={{
              ...NODE_STYLE,
              ...NP.discover,
              animation: 'nodeIn .75s cubic-bezier(.16,1,.3,1) .45s both',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: -14,
                transform: 'translate(-50%, -100%)',
                background:
                  'linear-gradient(135deg,rgb(var(--constellation-cyan-rgb)),rgb(var(--constellation-cyan-bright-rgb)))',
                color: 'rgb(var(--constellation-navy-deep-rgb))',
                fontWeight: 700,
                fontSize: 10.5,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                padding: '5px 11px',
                borderRadius: 999,
                whiteSpace: 'nowrap',
                boxShadow: '0 0 14px rgb(var(--constellation-cyan-rgb) / .6)',
                animation: 'tagBob 1.7s ease-in-out infinite',
              }}
            >
              Start here
            </div>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '1.5px solid rgb(var(--constellation-cyan-bright-rgb))',
                opacity: 0.5,
              }}
            />
            {current === 'discover' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  border: '2px solid rgb(var(--constellation-cyan-paler-rgb))',
                  animation: 'nodePulse 1.7s ease-out infinite',
                }}
              />
            )}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '1.5px solid rgb(var(--constellation-cyan-rgb))',
                animation:
                  current === 'discover'
                    ? 'nodePulse 1.7s ease-out .85s infinite'
                    : 'nodePulse 2.6s ease-out infinite',
              }}
            />
            <div
              style={
                current === 'discover'
                  ? { ...ACTIVE_INNER, animation: 'ctaGlow 1.7s ease-in-out infinite' }
                  : { ...ACTIVE_INNER, boxShadow: '0 0 20px rgb(var(--constellation-cyan-rgb) / .5)' }
              }
            >
              <svg
                viewBox="0 0 24 24"
                style={{
                  width: 23,
                  height: 23,
                  stroke: 'rgb(var(--constellation-navy-rgb))',
                  fill: 'none',
                  strokeWidth: 2.2,
                }}
              >
                <circle cx="12" cy="8.5" r="3.2" />
                <path d="M5 20c1.5-4 4-6 7-6s5.5 2 7 6" />
              </svg>
            </div>
            <div
              className="font-rajdhani"
              style={{ ...NODE_LABEL, color: 'rgb(var(--constellation-cyan-paler-rgb))' }}
            >
              Discover
            </div>
          </div>

          {/* Transform — top-right */}
          <DimensionNode
            position={NP.transform}
            animationDelay=".65s"
            onClick={onTransform}
            locked={!enabled.transform}
            highlighted={current === 'transform'}
            label="Transform"
            iconPaths={
              <>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-4-4" />
              </>
            }
          />

          {/* Release — bottom-right */}
          <DimensionNode
            position={NP.release}
            animationDelay=".75s"
            onClick={onRelease}
            locked={!enabled.release}
            highlighted={current === 'release'}
            label="Release"
            iconPaths={
              <>
                <circle cx="12" cy="8" r="3.4" />
                <path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5" />
              </>
            }
          />

          {/* Grow — bottom-left */}
          <DimensionNode
            position={NP.grow}
            animationDelay=".8s"
            onClick={onGrow}
            locked={!enabled.grow}
            highlighted={current === 'grow'}
            label="Grow"
            iconPaths={<path d="M4 20V10M11 20V4M18 20v-7" />}
          />

          {/* Start Again — bottom-center (always enabled) */}
          <div
            role="button"
            tabIndex={0}
            onClick={onStartAgain}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onStartAgain();
              }
            }}
            style={{
              ...NODE_STYLE,
              ...NP.startAgain,
              animation: 'nodeIn .75s cubic-bezier(.16,1,.3,1) .85s both',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '1.5px solid rgb(var(--constellation-cyan-bright-rgb))',
                opacity: 0.5,
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '1.5px solid rgb(var(--constellation-cyan-rgb))',
                animation: 'nodePulse 2.6s ease-out infinite',
              }}
            />
            <div
              style={{
                ...ACTIVE_INNER,
                boxShadow: '0 0 20px rgb(var(--constellation-cyan-rgb) / .5)',
              }}
            >
              <svg
                viewBox="0 0 24 24"
                style={{
                  width: 23,
                  height: 23,
                  stroke: 'rgb(var(--constellation-navy-rgb))',
                  fill: 'none',
                  strokeWidth: 2.2,
                }}
              >
                <path d="M4 4v6h6M20 20v-6h-6" />
                <path d="M5 15a8 8 0 0013.5 3.5M19 9A8 8 0 005.5 5.5" />
              </svg>
            </div>
            <div className="font-rajdhani" style={NODE_LABEL}>
              Start Again
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className="font-rajdhani"
        style={{
          flexShrink: 0,
          textAlign: 'center',
          fontWeight: 600,
          fontSize: 12,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'rgb(var(--constellation-slate-dark-rgb))',
          animation: 'fadeIn .8s ease 1.2s both',
        }}
      >
        Tap the center HUD to return home
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PersonalityJourney() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const location = useLocation();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const phase: Phase = location.pathname.endsWith('/DimensionCircles') ? 2 : 1;
  const [mergedData, setMergedData] = useState<Record<string, unknown>>({});
  const [childName, setChildName] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [initError, setInitError] = useState(false);
  const [showDiscoverSplash, setShowDiscoverSplash] = useState(false);
  const [discoverCompleted, setDiscoverCompleted] = useState(false);
  const [growCompleted, setGrowCompleted] = useState(false);
  const [transformVisited, setTransformVisited] = useState(false);
  const [releaseVisited, setReleaseVisited] = useState(false);
  const [connectVisited, setConnectVisited] = useState(false);
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const { doStartOver, isStartingOver } = useStartOver(childId);

  const handleDiscoverSplashReady = useCallback(() => {
    setShowDiscoverSplash(false);
    if (childId && !discoverCompleted) {
      setDiscoverCompleted(true);
      api.entities.Child.update(childId, { discover_completed: true }).catch(console.error);
    }
    void navigate(`/PersonalityProfile/${childId ?? ''}`);
  }, [navigate, childId, discoverCompleted]);
  const [childData, setChildData] = useState<Record<string, unknown> | null>(null);
  const mergedDataRef = useRef<Record<string, unknown> | null>(null);

  // Grow unlocks Transform once at least one of the six growth areas is completed.
  // Checked two ways and both must pass: the persisted grow_completed flag on the
  // child (set once, in GrowthAreas.tsx, the moment an area is first completed) and
  // a live query of the growth_areas collection — the flag alone could go stale if
  // that collection were ever cleared/reset independently of the child document.
  const { data: completedGrowthAreasData } = useQuery({
    queryKey: ['completedGrowthAreas', childId],
    queryFn: () => api.completedGrowthAreas.list(childId!),
    enabled: phase === 2 && Boolean(childId),
  });
  const hasCompletedGrowthArea =
    completedGrowthAreasData?.areas?.some((a) => a.status === 'completed') ?? false;
  const growUnlocksTransform = growCompleted && hasCompletedGrowthArea;

  // The frontier circle the hub's glow/dots should point to: the next step the
  // user hasn't reached yet in Discover → Grow → Transform → Release → Connect.
  // null once Connect has been visited too — nothing left to point at.
  const currentDimension: ActiveDimension = !discoverCompleted
    ? 'discover'
    : !growUnlocksTransform
      ? 'grow'
      : !transformVisited
        ? 'transform'
        : !releaseVisited
          ? 'release'
          : !connectVisited
            ? 'connect'
            : null;

  // ── Sound + warp-enter ────────────────────────────────────────────────────────
  const { ttsEnabled: soundOn } = useTts();
  const [isEntering, setIsEntering] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const warpCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const warpRafRef = useRef<number | null>(null);
  const enterTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Play intro voice when orb screen (phase 1) is active — mirrors HTML's playVoice()
  const orbVoiceRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (phase !== 1 || !soundOn) {
      orbVoiceRef.current?.pause();
      return;
    }
    const audio = new Audio('/orb-voice.mp3');
    audio.volume = 0.9;
    orbVoiceRef.current = audio;
    const timer = setTimeout(() => {
      audio.play().catch(() => {});
    }, 800);
    return () => {
      clearTimeout(timer);
      audio.pause();
    };
  }, [phase, soundOn]);

  // Looping ambient bed — shared across the whole journey (see
  // AmbientAudioContext) so it keeps playing uninterrupted as the user moves
  // between this page and the pages it leads to, rather than restarting per page.
  const { duck: duckAmbient, setSuppressed: setAmbientSuppressed } = useAmbientAudio();

  // The Discover splash (stage 2) plays its own unmuted video — keep the
  // ambient bed silent for that beat so the two don't overlap.
  useEffect(() => {
    setAmbientSuppressed(showDiscoverSplash);
    return () => setAmbientSuppressed(false);
  }, [showDiscoverSplash, setAmbientSuppressed]);

  // Cleanup warp on unmount
  useEffect(
    () => () => {
      enterTimersRef.current.forEach(clearTimeout);
      if (warpRafRef.current) cancelAnimationFrame(warpRafRef.current);
    },
    [],
  );

  const getAudioCtx = () => {
    audioCtxRef.current ??= new AudioContext();
    if (audioCtxRef.current.state === 'suspended') void audioCtxRef.current.resume();
    return audioCtxRef.current;
  };

  const whoosh = () => {
    if (!soundOn) return;
    try {
      const ac = getAudioCtx(),
        t = ac.currentTime;
      const len = Math.floor(ac.sampleRate * 2.4);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(180, t);
      bp.frequency.exponentialRampToValueAtTime(4200, t + 1.6);
      bp.frequency.exponentialRampToValueAtTime(400, t + 2.3);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 1.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.35);
      src.connect(bp).connect(g).connect(ac.destination);
      src.start(t);
      src.stop(t + 2.4);
      const o = ac.createOscillator(),
        og = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(70, t + 1.55);
      o.frequency.exponentialRampToValueAtTime(36, t + 2.4);
      og.gain.setValueAtTime(0.0001, t + 1.55);
      og.gain.exponentialRampToValueAtTime(0.55, t + 1.68);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.connect(og).connect(ac.destination);
      o.start(t + 1.55);
      o.stop(t + 2.6);
    } catch {
      /* noop */
    }
  };

  // Start hyperspace-streak canvas (exact match to HTML)
  useEffect(() => {
    if (!isEntering) return;
    const c = warpCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const w = (c.width = window.innerWidth),
      h = (c.height = window.innerHeight);
    const cx = w / 2,
      cy = h / 2;
    const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
    const palette = ['#ffffff', '#dff6ff', '#8ef2ff', '#b9c6ff', '#ffe6c9'];
    type Star = { a: number; d: number; z: number; tw: number; col: string };
    const stars: Star[] = Array.from({ length: 340 }, () => ({
      a: Math.random() * Math.PI * 2,
      d: Math.random() * far + 4,
      z: Math.random() * 0.85 + 0.15,
      tw: Math.random() * Math.PI * 2,
      col: palette[Math.floor(Math.random() * palette.length)] ?? '#ffffff',
    }));
    const duration = 4600;
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = Math.min(1.15, (now - t0) / duration);
      if (t >= 1.15) {
        ctx.clearRect(0, 0, w, h);
        return;
      }
      const glide = 0.9 + Math.sin(Math.min(1, t) * Math.PI) * 3.4;
      const alpha = t < 0.18 ? t / 0.18 : t > 0.82 ? Math.max(0, (1.02 - t) / 0.2) : 1;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      for (const s of stars) {
        const prev = s.d;
        s.d += s.z * glide * 1.5;
        if (s.d > far * 1.12) {
          s.d = 6 + Math.random() * 30;
          s.a = Math.random() * Math.PI * 2;
          continue;
        }
        s.tw += 0.05;
        const ca = Math.cos(s.a),
          sa = Math.sin(s.a);
        const len = Math.min((s.d - prev) * 5.5, 70);
        const depth = Math.min(1, 0.2 + s.d / (far * 0.75));
        ctx.strokeStyle = s.col;
        ctx.globalAlpha = alpha * depth * (0.55 + 0.45 * Math.sin(s.tw));
        ctx.lineWidth = Math.min(2.2, 0.4 + s.z * 1.6 * depth);
        ctx.beginPath();
        ctx.moveTo(cx + ca * (s.d - len), cy + sa * (s.d - len));
        ctx.lineTo(cx + ca * s.d, cy + sa * s.d);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      warpRafRef.current = requestAnimationFrame(draw);
    };
    warpRafRef.current = requestAnimationFrame(draw);
    return () => {
      if (warpRafRef.current) cancelAnimationFrame(warpRafRef.current);
    };
  }, [isEntering]);

  const handleEnterNav = () => {
    if (isEntering) return;
    setIsEntering(true);
    whoosh();
    duckAmbient(0.12, 1600);
    orbVoiceRef.current?.pause();
    enterTimersRef.current.forEach(clearTimeout);
    // Match HTML timing: phase:'nav' at 3350ms, warp:false at 5100ms, scope:false at 5700ms
    const t1 = setTimeout(
      () => void navigate(`/PersonalityJourney/${childId ?? ''}/DimensionCircles`),
      3350,
    );
    const t2 = setTimeout(() => setIsEntering(false), 5700);
    const t3 = setTimeout(() => duckAmbient(0.5, 1800), 5700);
    enterTimersRef.current = [t1, t2, t3];
  };
  // ─────────────────────────────────────────────────────────────────────────────

  const markJourneyComplete = useCallback(async () => {
    if (!childId) return;
    try {
      await api.entities.Child.update(childId, { onboarding_phase: 3, onboarding_completed: true });
    } catch {
      /* non-fatal */
    }
  }, [childId]);

  const finalizePersonality = useCallback(async () => {
    if (!childId) return;
    try {
      const child = await api.entities.Child.get(childId);
      const personality = child?.personality;
      const pendingVm = (child?.pending_personality_vm ?? personality?.pending_view_model) as
        | Record<string, unknown>
        | undefined;
      const merged = mergedDataRef.current;

      let vm: Record<string, unknown> | null = null;
      if (pendingVm && merged) {
        const adapted = adaptAiPersonalityToViewModel(pendingVm, merged.name as string);
        vm = sanitizeViewModelAvatars(adapted);
        api.entities.Child.update(childId, {
          personality: { source: 'llm', view_model: stripViewModelImages(adapted) },
          onboarding_phase: 2,
        }).catch((err) =>
          console.error('[PersonalityJourney] Failed to persist personality:', err),
        );
      } else if (personality?.view_model?.profile?.name) {
        vm = sanitizeViewModelAvatars(
          maybeClampStoredPersonalityDescription(personality.view_model, {
            analysisSource: personality?.source,
          }),
        );
      }

      void vm;
      setIsAnalyzing(false);
      await markJourneyComplete();
    } catch (err) {
      console.error('[PersonalityJourney] Failed to finalize personality:', err);
      setIsAnalyzing(false);
      setInitError(true);
    }
  }, [childId, markJourneyComplete]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_personality_analysis',
    onCompleted: finalizePersonality,
  });

  const { enqueue: enqueueJob } = job;

  // Surface job failures as page error
  useEffect(() => {
    if (job.isFailed) {
      setIsAnalyzing(false);
      setInitError(true);
    }
  }, [job.isFailed]);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      void navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      void navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;
        if (!child) {
          void navigate('/Home', { replace: true });
          return;
        }

        const personality = child.personality;
        const vm = personality?.view_model;
        const merged = mergeChildDraft(normalizeOnboardingChildDataBlob(child) ?? {});
        mergedDataRef.current = merged;
        setChildName(merged.name || '');
        setMergedData(merged);
        setDiscoverCompleted(Boolean(child.discover_completed));
        setGrowCompleted(Boolean(child.grow_completed));
        setTransformVisited(Boolean(child.transform_visited));
        setReleaseVisited(Boolean(child.release_visited));
        setConnectVisited(Boolean(child.connect_visited));

        if (vm?.profile?.name) {
          // Personality already analysed — show orb immediately, fully interactive
          setIsInitializing(false);
          if (!child.onboarding_completed) {
            await markJourneyComplete();
          }
          return;
        }

        // No complete personality yet — need to run or resume analysis
        if (!merged.name?.trim()) {
          void navigate(`/ConversationalOnboarding/${childId}`, { replace: true });
          return;
        }

        // Check for pending_personality_vm (LLM done but write-back not yet saved as view_model)
        const pendingVm = (child.pending_personality_vm ?? personality?.pending_view_model) as
          | Record<string, unknown>
          | undefined;
        if (pendingVm) {
          const adapted = adaptAiPersonalityToViewModel(pendingVm, merged.name);
          if (cancelled) return;
          setIsInitializing(false);
          api.entities.Child.update(childId, {
            personality: { source: 'llm', view_model: stripViewModelImages(adapted) },
            onboarding_phase: 2,
          }).catch(console.error);
          await markJourneyComplete();
          return;
        }

        // Show orb in analyzing state while job runs in background
        setChildData(child);
        setIsAnalyzing(true);
        setIsInitializing(false);

        // Only enqueue if no job is already running
        const activeJobId = child.active_jobs?.generate_personality_analysis;
        if (!activeJobId) {
          await enqueueJob({
            type: 'generate_personality_analysis',
            child_id: childId,
            payload: {
              prompt: buildPersonalityAnalysisPrompt({
                childData: merged,
                personalityTypeKeys: PERSONALITY_TYPE_KEYS,
              }),
              response_json_schema: personalityLlmSchema(),
            },
            write_back: { collection: 'children', filter: {}, field: 'pending_personality_vm' },
          });
        }
        // else: useJob picks up activeJobId from setChildData(child) and polls automatically
      } catch (err) {
        console.warn('[PersonalityJourney] Load failed:', err);
        if (!cancelled) {
          setInitError(true);
          setIsInitializing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate, markJourneyComplete, enqueueJob]);

  const status = isLoadingAuth || isInitializing ? 'loading' : initError ? 'error' : 'ready';

  if (status === 'loading') {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: 'rgb(var(--constellation-navy-deep-rgb))' }}
      >
        <Spinner
          style={{
            borderColor: 'rgb(var(--constellation-cyan-bright-rgb) / 0.6)',
            borderTopColor: 'transparent',
          }}
        />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
        <p className="text-muted-foreground">Something went wrong. Please try again.</p>
        <Button onClick={() => void navigate('/Home')} className="btn-primary rounded-2xl px-8">
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen overflow-hidden"
      style={{ background: 'rgb(var(--constellation-navy-deep-rgb))' }}
    >
      {/* Global warp keyframes */}
      <style>{`
        @keyframes scopeDolly {
          0%   { transform:scale(1);    filter:blur(0px)  saturate(1);    opacity:1; }
          60%  { transform:scale(1.28); filter:blur(1.2px) saturate(1.15); opacity:1; }
          100% { transform:scale(1.55); filter:blur(7px)  saturate(1.3);  opacity:0; }
        }
        @keyframes voidVeil {
          0%  { opacity:0; }
          30% { opacity:1; }
          72% { opacity:.9; }
          100%{ opacity:0; }
        }
        @keyframes nebulaDrift {
          0%   { opacity:0;   transform:translate(-50%,-50%) scale(.6)  rotate(0deg); }
          22%  { opacity:.85; }
          70%  { opacity:.7;  }
          100% { opacity:0;   transform:translate(-50%,-50%) scale(2.6) rotate(26deg); }
        }
        @keyframes uiDissolve {
          0%   { opacity:1; filter:blur(0); }
          100% { opacity:0; filter:blur(7px); }
        }
      `}</style>

      {/* Warp enter overlays */}
      {isEntering && (
        <>
          <canvas
            ref={warpCanvasRef}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 52,
              pointerEvents: 'none',
              width: '100%',
              height: '100%',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 51,
              pointerEvents: 'none',
              background: 'rgb(var(--constellation-navy-deep-rgb))',
              animation: 'voidVeil 5.6s ease forwards',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              left: '50%',
              top: '50%',
              zIndex: 50,
              width: 520,
              height: 520,
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgb(var(--constellation-teal-deep-rgb) / 0.9) 0%, rgb(var(--constellation-cyan-bright-rgb) / 0.35) 38%, transparent 70%)',
              pointerEvents: 'none',
              animation: 'nebulaDrift 5.6s cubic-bezier(.4,0,.35,1) forwards',
            }}
          />
        </>
      )}

      {/* Ambient background blob */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: 'radial-gradient(circle, rgb(var(--constellation-teal-deep-rgb) / 0.35) 0%, transparent 60%)' }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-lg">
        <AnimatePresence mode="wait">
          {phase === 1 && (
            <motion.div
              key="phase-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.05 } }}
              style={
                isEntering ? { animation: 'scopeDolly 3.4s cubic-bezier(.35,0,.3,1) forwards' } : {}
              }
              className="min-h-screen"
            >
              <BuddyOrbScreen
                childName={childName}
                isAnalyzing={isAnalyzing}
                onTap={handleEnterNav}
              />
            </motion.div>
          )}

          {phase === 2 && (
            <motion.div
              key="phase-2"
              initial={{ opacity: 0, scale: 1.06 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.5 }}
              className="min-h-screen"
            >
              <DimensionCirclesScreen
                childName={childName}
                mergedData={mergedData}
                onConnect={() => void navigate(`/Connect/${childId ?? ''}`)}
                onDiscover={() => setShowDiscoverSplash(true)}
                onGoHome={() => void navigate(`/PersonalityJourney/${childId ?? ''}`)}
                onGrow={() => void navigate(`/GrowthAreas/${childId ?? ''}`)}
                onTransform={() => void navigate(`/LifePathway/${childId ?? ''}`)}
                onRelease={() => void navigate(`/Observations/${childId ?? ''}`)}
                onStartAgain={() => setConfirmingStartOver(true)}
                enabled={{
                  grow: discoverCompleted,
                  transform: growUnlocksTransform,
                  release: transformVisited,
                  connect: transformVisited,
                }}
                current={currentDimension}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showDiscoverSplash && <StageSplash stage={2} onReady={handleDiscoverSplashReady} />}
      </AnimatePresence>

      <AnimatePresence>
        {confirmingStartOver && (
          <StartOverConfirmModal
            onCancel={() => setConfirmingStartOver(false)}
            onConfirm={() => {
              setConfirmingStartOver(false);
              void doStartOver();
            }}
            isStartingOver={isStartingOver}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
