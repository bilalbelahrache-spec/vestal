import { useEffect, useRef } from "preact/hooks";

/**
 * Observes every `.reveal` descendant of the returned ref and adds
 * `.is-visible` the first time each scrolls into view, then stops
 * watching it — a one-shot entrance, not a replay-on-scroll toggle.
 * Under `prefers-reduced-motion: reduce` everything is marked visible
 * immediately instead of observed, matching the CSS fallback in index.css.
 */
export function useRevealGroup<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    if (targets.length === 0) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    targets.forEach((el, i) => {
      el.style.setProperty("--stagger-i", String(i % 6));
      io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  return ref;
}

/**
 * Tracks pointer position as CSS percentages (`--mx`/`--my`) on the
 * returned ref, rAF-throttled to at most one style write per frame.
 * Powers the pointer-reactive gradient glow on the hero/auth panels.
 * No-ops under reduced motion, leaving the panel's static gradient in place.
 */
export function usePointerGlow<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    function onMove(e: PointerEvent) {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = el!.getBoundingClientRect();
        const mx = ((e.clientX - rect.left) / rect.width) * 100;
        const my = ((e.clientY - rect.top) / rect.height) * 100;
        el!.style.setProperty("--mx", `${mx}%`);
        el!.style.setProperty("--my", `${my}%`);
      });
    }
    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return ref;
}

/**
 * A pointer-driven 3D tilt: rotates the element toward the cursor based on
 * where within its bounds the pointer sits, rAF-throttled, reset smoothly
 * on pointer leave. Deliberately not applied to anything that already runs
 * a CSS `animation` on `transform` (e.g. the hero's floating cards) —
 * a running CSS animation wins the cascade for the properties it animates
 * over an element's own inline style, so an inline tilt transform would
 * silently never render there. Safe on anything without a competing
 * transform animation, like the dashboard's check cards.
 */
export function useTilt<T extends HTMLElement>(strength = 8) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    function onMove(e: PointerEvent) {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = el!.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        el!.style.transform = `perspective(700px) rotateX(${(-py * strength).toFixed(2)}deg) rotateY(${(px * strength).toFixed(2)}deg)`;
      });
    }
    function onLeave() {
      el!.style.transform = "";
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [strength]);

  return ref;
}
