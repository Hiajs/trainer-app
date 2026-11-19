import { useId } from 'react';

/** The SearchGPT X mark: a flowing S drawn with the brand gradient. */
export function Logo({ size = 32, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-label="SearchGPT X">
      <defs>
        <linearGradient id={`g${id}`} x1="10" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFC93C" />
          <stop offset="0.35" stopColor="#FF7A2F" />
          <stop offset="0.68" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#3A7BFF" />
        </linearGradient>
      </defs>
      <path
        d="M71 27C66 18 56 14 47 14C33 14 25 23 25 33C25 46 37 49 50 51C63 53 75 56 75 69C75 80 66 86 53 86C42 86 32 81 28 72"
        fill="none"
        stroke={`url(#g${id})`}
        strokeWidth="15"
        strokeLinecap="round"
      />
      <circle cx="80" cy="16" r="6" fill="#3A7BFF" />
    </svg>
  );
}
