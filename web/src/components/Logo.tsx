/**
 * The flame is Vestal's namesake (the Roman hearth goddess's eternal
 * flame); the notch cut into it is a checkmark, rendered in `--bg` so it
 * reads as a literal cutout rather than a second overlapping shape —
 * "verification" and "flame" fused into one mark instead of a generic
 * gradient blob.
 */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16 2c3.6 4.4 7 8.9 7 13.2C23 20.6 19.9 25 16 25s-7-4.4-7-9.8C9 10.9 12.4 6.4 16 2Z"
      />
      <path
        fill="var(--bg)"
        d="m11.7 16.3 3 3 5.6-6.2-1.5-1.35-4.24 4.7-1.6-1.6z"
      />
    </svg>
  );
}

export function Wordmark({ size = 20, class: className }: { size?: number; class?: string }) {
  return (
    <span class={`wordmark${className ? ` ${className}` : ""}`}>
      <Logo size={size} />
      <span>Vestal</span>
    </span>
  );
}
