import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext, useEffect, useState, useCallback } from "preact/hooks";

interface RouterState {
  path: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterState | null>(null);

/**
 * Runs a navigation state change inside the View Transitions API when the
 * browser supports it and the visitor hasn't asked for reduced motion —
 * gives every route change a real crossfade/slide (styled in app.css via
 * ::view-transition-old/new(root)) instead of an instant content swap.
 * Falls back to a plain synchronous update everywhere else; nothing about
 * navigation depends on the transition actually running.
 */
function runTransition(update: () => void) {
  const supportsVT = typeof document.startViewTransition === "function";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (supportsVT && !reduced) {
    document.startViewTransition(update);
  } else {
    update();
  }
}

/**
 * Scrolls to a same-page anchor (e.g. "#how-it-works") if the URL has one,
 * otherwise resets to the top of the new page — run after every navigation
 * so a route change never leaves the visitor scrolled to wherever the
 * previous page happened to be. requestAnimationFrame defers past the
 * commit that just mounted the new route's content, since scrollIntoView
 * on an element that doesn't exist yet (still the old page's DOM) is a
 * silent no-op, not an error — this was caught by literally clicking
 * "How it works" from a page other than "/" and finding the id genuinely
 * isn't in the DOM yet at the moment setPath's effect first fires.
 */
function scrollForNavigation() {
  const hash = window.location.hash;
  requestAnimationFrame(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  });
}

/**
 * A minimal hand-rolled History-API router — deliberately not a dependency
 * for an app with five routes and zero URL params. Real behavior, not a
 * toy: back/forward navigation, replace-vs-push, and intercepted <Link>
 * clicks all work the same way a router library's would.
 *
 * `path` is always `window.location.pathname` alone, never the raw string
 * passed to `navigate()` — a hash link like "/#how-it-works" used to be
 * stored verbatim as the path, which matched no <Route> (they're all bare
 * pathnames) and silently fell through to the 404 catch-all instead of
 * landing on "/" and scrolling to the section. Deriving it from
 * `window.location.pathname` after the history update, the same way the
 * popstate handler already did, fixes both direct navigation and back/
 * forward for hash links alike.
 */
export function RouterProvider({ children }: { children: ComponentChildren }) {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => {
      runTransition(() => setPath(window.location.pathname));
      scrollForNavigation();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) {
      window.history.replaceState(null, "", to);
    } else {
      window.history.pushState(null, "", to);
    }
    runTransition(() => setPath(window.location.pathname));
    scrollForNavigation();
  }, []);

  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>;
}

/**
 * A router provider for prerendering (`web/scripts/prerender.tsx`) only:
 * fixes `path` to whatever route is being rendered and makes `navigate` a
 * no-op, since there's no `window.location`/history to touch in Node and
 * nothing ever clicks a link during a `renderToString` pass anyway.
 */
export function StaticRouterProvider({ path, children }: { path: string; children: ComponentChildren }) {
  return <RouterContext.Provider value={{ path, navigate: () => {} }}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterState {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used inside RouterProvider");
  return ctx;
}

export function Link({
  to,
  class: className,
  children,
}: {
  to: string;
  class?: string;
  children: ComponentChildren;
}) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      class={className}
      onClick={(e) => {
        // Let modifier-clicks (open in new tab, etc.) behave normally.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function Route({ path, children }: { path: string; children: ComponentChildren }) {
  const { path: current } = useRouter();
  // "*" is the catch-all fallback — Switch already decided this Route is
  // the match for any unrecognized path, so it must render unconditionally
  // rather than re-testing current === "*" (which is never literally true
  // for a real URL, and silently rendered nothing for every 404 before
  // this fix).
  return current === path || path === "*" ? <>{children}</> : null;
}

export function Switch({ children }: { children: ComponentChildren }) {
  const { path: current } = useRouter();
  const kids = Array.isArray(children) ? children : [children];
  // Exact match wins regardless of declaration order; "*" is only a
  // fallback, not just "whichever comes first in the list."
  const matched =
    kids.find((child: any) => child?.props?.path === current) ??
    kids.find((child: any) => child?.props?.path === "*");
  return <>{matched}</>;
}
