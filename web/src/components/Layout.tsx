import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useAuth } from "../context/auth";
import { useToast } from "../context/toast";
import { Link, useRouter } from "../router";
import { Wordmark } from "./Logo";
import { SitePanel } from "./SitePanel";

const NAV_LINKS = [
  { label: "Docs", to: "/docs" },
  { label: "Pricing", to: "/pricing" },
  { label: "Security", to: "/security" },
  { label: "Changelog", to: "/changelog" },
];

export function Layout({ children, bleed }: { children: ComponentChildren; bleed?: boolean }) {
  const { user, logout } = useAuth();
  const { navigate, path } = useRouter();
  const { showError } = useToast();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isTeam = user?.plan === "team";
  const isPro = user?.plan === "pro" || isTeam;

  // Hysteresis, not a single threshold: `.is-scrolled` shrinks the sticky
  // header's padding (see app.css), which shrinks total document height by
  // enough that the browser clamps window.scrollY back down right at the
  // boundary — that clamp fires its own 'scroll' event, which this
  // listener sees, which flips `scrolled` back off, growing the header
  // again, repeating forever. Caught for real (not theoretical): a
  // MutationObserver watching the header's class attribute during an
  // automated run showed it toggling continuously, which cascaded into
  // Playwright's actionability check never seeing two stable frames on
  // anything below the header. A gap between the enter/exit thresholds
  // means the post-clamp scrollY can't be on both the wrong side of "still
  // scrolled" and the wrong side of "no longer scrolled" at once, so the
  // state settles after the one legitimate transition instead of bouncing.
  useEffect(() => {
    function onScroll() {
      setScrolled((was) => (was ? window.scrollY > 4 : window.scrollY > 12));
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Route changes close the mobile menu — otherwise it sits open over the
  // new page.
  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  async function onLogout() {
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch {
      showError("Couldn't log out. Try again.");
    }
  }

  return (
    <div class="app-shell">
      <header class={`app-header${scrolled ? " is-scrolled" : ""}`}>
        <div class="app-header-inner">
          <Link to="/" class="brand">
            <Wordmark />
          </Link>

          {!user && (
            <nav class="header-center" aria-label="Main">
              {NAV_LINKS.map((l) => (
                <Link to={l.to} class={`nav-link${path === l.to ? " is-active" : ""}`}>
                  {l.label}
                </Link>
              ))}
            </nav>
          )}

          <nav class="header-right">
            {user ? (
              <>
                <Link to="/docs" class="nav-link nav-hide-mobile">
                  Docs
                </Link>
                <span class="nav-email nav-hide-mobile">
                  {user.email}
                  <span class={`plan-badge${isPro ? " plan-badge-pro" : ""}`}>{isTeam ? "Team" : isPro ? "Pro" : "Free"}</span>
                </span>
                <button type="button" class="btn-secondary nav-hide-mobile" onClick={onLogout}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" class="nav-link nav-hide-mobile">
                  Log in
                </Link>
                <Link to="/signup" class="btn-primary btn-sm">
                  Get started
                </Link>
              </>
            )}
            <button
              type="button"
              class="nav-burger"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>
          </nav>
        </div>
      </header>
      <SitePanel open={menuOpen} onClose={() => setMenuOpen(false)} onLogout={user ? onLogout : undefined} />
      <main class={bleed ? "app-main app-main-bleed" : "app-main"}>{children}</main>
    </div>
  );
}
