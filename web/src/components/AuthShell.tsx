import type { ComponentChildren } from "preact";
import { usePointerGlow } from "../lib/motion";
import { Wordmark } from "./Logo";

export function AuthShell({
  eyebrow,
  headline,
  children,
}: {
  eyebrow: string;
  headline: string;
  children: ComponentChildren;
}) {
  const glowRef = usePointerGlow<HTMLDivElement>();
  return (
    <div class="auth-shell">
      <div class="auth-visual" ref={glowRef}>
        <div class="auth-visual-mark">
          <Wordmark />
        </div>
        <div class="auth-visual-copy">
          <p class="eyebrow">{eyebrow}</p>
          <h2>{headline}</h2>
        </div>
      </div>
      <div class="auth-form-panel">
        <div class="auth-form-mark">
          <Wordmark />
        </div>
        <div class="auth-form-inner">{children}</div>
      </div>
    </div>
  );
}
