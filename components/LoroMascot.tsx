export type LoroMascotState = 'idle' | 'happy' | 'sleeping';

type LoroMascotProps = {
  state?: LoroMascotState;
  /** rendered size in px (square) */
  size?: number;
  className?: string;
};

/**
 * Loro the parrot — geometric placeholder, to be art-directed later.
 * The `state` prop API is stable; only the drawing will change.
 */
export function LoroMascot({ state = 'idle', size = 96, className }: LoroMascotProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      role="img"
      aria-label={`Loro the parrot (${state})`}
      className={className}
    >
      {/* tail */}
      <path d="M38 70 L26 90 L44 78 Z" fill="var(--accent-deep, #3d8b40)" />
      {/* body */}
      <ellipse cx="48" cy="54" rx="24" ry="28" fill="var(--accent, #58cc4e)" />
      {/* belly */}
      <ellipse cx="50" cy="62" rx="13" ry="16" fill="#a8e89f" />
      {/* wing — raised when happy */}
      <ellipse
        cx={state === 'happy' ? 26 : 31}
        cy={state === 'happy' ? 42 : 56}
        rx="10"
        ry="16"
        fill="var(--accent-deep, #3d8b40)"
        transform={state === 'happy' ? 'rotate(-40 26 42)' : 'rotate(-12 31 56)'}
      />
      {/* red crest — three bold angular feathers, tucked under the head.
          Lifts slightly when happy, droops when sleeping. */}
      <g
        fill="var(--loro-crest, #d14b3c)"
        transform={
          state === 'happy'
            ? 'translate(0 -2.5) rotate(-6 56 14)'
            : state === 'sleeping'
              ? 'translate(1.5 2) rotate(16 56 16)'
              : undefined
        }
      >
        <path d="M50 17 L42 5 L53 12 Z" />
        <path d="M53 15 L54 0 L60 13 Z" />
        <path d="M59 14 L66 5 L63 15 Z" />
      </g>
      {/* head */}
      <circle cx="56" cy="30" r="18" fill="var(--accent, #58cc4e)" />
      {/* face patch */}
      <circle cx="62" cy="30" r="10" fill="#f3f9ef" />
      {/* eye */}
      {state === 'sleeping' ? (
        <path d="M58 30 Q62 33 66 30" stroke="#1c2a1e" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      ) : (
        <>
          <circle cx="62" cy="29" r={state === 'happy' ? 4.5 : 3.5} fill="#1c2a1e" />
          <circle cx="63.5" cy="27.5" r="1.3" fill="#ffffff" />
        </>
      )}
      {/* beak — open when happy */}
      {state === 'happy' ? (
        <>
          <path d="M72 30 Q84 30 78 38 L70 35 Z" fill="#f5a623" />
          <path d="M71 37 Q80 42 73 44 L69 39 Z" fill="#d98c12" />
        </>
      ) : (
        <path d="M72 28 Q86 32 74 42 L69 34 Z" fill="#f5a623" />
      )}
      {/* zzz when sleeping */}
      {state === 'sleeping' && (
        <g fill="var(--muted, #9db3a8)" fontFamily="inherit" fontWeight="700">
          <text x="76" y="16" fontSize="12">z</text>
          <text x="84" y="9" fontSize="9">z</text>
        </g>
      )}
      {/* feet */}
      <path d="M42 81 L42 88 M50 82 L50 89" stroke="#f5a623" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
