import { useEffect, useRef } from "preact/hooks";
import { useAuth } from "../context/auth";
import { Link, useRouter } from "../router";

interface NavSection {
  title: string;
  links: { label: string; to: string }[];
}

const LOGGED_OUT_SECTIONS: NavSection[] = [
  {
    title: "Product",
    links: [
      { label: "Home", to: "/" },
      { label: "How it works", to: "/#how-it-works" },
      { label: "Pricing", to: "/pricing" },
      { label: "For MSPs & teams", to: "/msp" },
      { label: "Documentation", to: "/docs" },
      { label: "Changelog", to: "/changelog" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Security", to: "/security" },
      { label: "Privacy", to: "/privacy" },
      { label: "Terms", to: "/terms" },
      { label: "Refund policy", to: "/refund" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Create an account", to: "/signup" },
      { label: "Log in", to: "/login" },
    ],
  },
];

const LOGGED_IN_SECTIONS: NavSection[] = [
  {
    title: "Your account",
    links: [
      { label: "Dashboard", to: "/dashboard" },
      { label: "Organizations", to: "/organizations" },
      { label: "Documentation", to: "/docs" },
    ],
  },
  {
    title: "Product",
    links: [
      { label: "Pricing", to: "/pricing" },
      { label: "For MSPs & teams", to: "/msp" },
      { label: "Changelog", to: "/changelog" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Security", to: "/security" },
      { label: "Privacy", to: "/privacy" },
      { label: "Terms", to: "/terms" },
      { label: "Refund policy", to: "/refund" },
    ],
  },
];

/**
 * A full-height slide-in drawer covering every section of the site, not
 * just the handful of links that fit in the header — a real <dialog>
 * (showModal) for the same free focus-trap/Escape/backdrop behavior
 * ConfirmDialog relies on, styled in the same Redwood-register flat,
 * warm-paper-over-near-black-buttons language as the rest of the app
 * (see index.css's header comment) rather than a generic slide-out.
 */
export function SitePanel({
  open,
  onClose,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  /** Only rendered for logged-in users — the header's own "Log out" button
   * hides on narrow screens (see Layout.tsx), so this is the only way to
   * log out on mobile once the header collapses to just the hamburger. */
  onLogout?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { user } = useAuth();
  const { path } = useRouter();
  const isTeam = user?.plan === "team";
  const isPro = user?.plan === "pro" || isTeam;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const sections = user ? LOGGED_IN_SECTIONS : LOGGED_OUT_SECTIONS;

  return (
    <dialog
      ref={ref}
      class="site-panel"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div class="site-panel-head">
        {user ? (
          <div class="site-panel-account">
            <span class="site-panel-email">{user.email}</span>
            <span class={`plan-badge${isPro ? " plan-badge-pro" : ""}`}>{isTeam ? "Team" : isPro ? "Pro" : "Free"}</span>
          </div>
        ) : (
          <p class="eyebrow">Explore Vestal</p>
        )}
        <button type="button" class="site-panel-close" aria-label="Close menu" onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <nav class="site-panel-nav" aria-label="Site">
        {sections.map((s) => (
          <div class="site-panel-section">
            <h4>{s.title}</h4>
            <ul>
              {s.links.map((l) => (
                <li>
                  <Link to={l.to} class={`site-panel-link${path === l.to ? " is-active" : ""}`}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {user && onLogout && (
          <div class="site-panel-section site-panel-logout">
            <button type="button" class="btn-secondary" onClick={onLogout}>
              Log out
            </button>
          </div>
        )}
      </nav>
    </dialog>
  );
}
