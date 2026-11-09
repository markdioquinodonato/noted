import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * The Noted "N" mark, drawn as vector art so it stays crisp at every size and
 * has a truly transparent background (no white fringe around the rounded tile).
 */
export function BrandMark({ className, size = 28 }: { className?: string; size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0 select-none', className)}
    >
      <defs>
        <linearGradient id={`${id}t`} x1="6" y1="2" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2E8BFF" />
          <stop offset="1" stopColor="#0058E0" />
        </linearGradient>
        <linearGradient
          id={`${id}f`}
          x1="46"
          y1="46"
          x2="60"
          y2="60"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F4F7FB" />
          <stop offset="1" stopColor="#B9C4D3" />
        </linearGradient>
      </defs>
      <path
        d="M15 2h34a13 13 0 0 1 13 13v29L44 62H15A13 13 0 0 1 2 49V15A13 13 0 0 1 15 2Z"
        fill={`url(#${id}t)`}
      />
      <path
        d="M20.5 45.5v-27l23 27v-27"
        stroke="#fff"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M44 62V51a7 7 0 0 1 7-7h11L44 62Z"
        fill="#003A99"
        fillOpacity=".35"
        transform="translate(-1.5 -1.5)"
      />
      <path d="M44 62V51a7 7 0 0 1 7-7h11L44 62Z" fill={`url(#${id}f)`} />
    </svg>
  );
}

/** Mark + "Noted" wordmark (inline, theme-aware). */
export function BrandLockup({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrandMark size={size} />
      <span
        className="font-bold tracking-tight text-foreground"
        style={{ fontSize: Math.round(size * 0.7) }}
      >
        Noted
      </span>
    </span>
  );
}

/** Stacked mark + wordmark. The wordmark follows the theme's text color. */
export function BrandLogo({ className, size = 96 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn('inline-flex flex-col items-center gap-2', className)}
      role="img"
      aria-label="Noted"
    >
      <BrandMark
        size={Math.round(size * 0.72)}
        className="drop-shadow-[0_10px_24px_rgba(0,102,239,0.35)]"
      />
      <span
        className="font-bold tracking-tight text-foreground"
        style={{ fontSize: Math.round(size * 0.26) }}
        aria-hidden="true"
      >
        Noted
      </span>
    </span>
  );
}
