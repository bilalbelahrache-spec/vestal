import { Link } from "../router";
import { Wordmark } from "./Logo";

const COLUMNS: { title: string; links: { label: string; to: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", to: "/#how-it-works" },
      { label: "Pricing", to: "/pricing" },
      { label: "Documentation", to: "/docs" },
      { label: "Changelog", to: "/changelog" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Contact us", to: "mailto:support@vestalapp.com" },
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
      { label: "Quickstart guide", to: "/docs" },
      { label: "Service health", to: "/health" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer class="site-footer">
      <div class="site-footer-inner container">
        <div class="site-footer-brand-col">
          <Wordmark class="site-footer-wordmark" />
          <p class="site-footer-tagline">
            Independent monitoring for backup restore verification. Your agent proves the
            repository is sound; Vestal makes sure someone finds out the moment that stops
            being true.
          </p>
          <p class="site-footer-madewith">
            Independent and self-funded. Free to start, no card required.
          </p>
        </div>
        <nav class="site-footer-cols" aria-label="Footer">
          {COLUMNS.map((col) => (
            <div class="site-footer-col">
              <h4>{col.title}</h4>
              <ul>
                {col.links.map((l) =>
                  l.to.startsWith("/#") || l.to === "/health" || l.to.startsWith("mailto:") ? (
                    <li>
                      <a href={l.to}>{l.label}</a>
                    </li>
                  ) : (
                    <li>
                      <Link to={l.to}>{l.label}</Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div class="site-footer-bottom container">
        <span>&copy; {new Date().getFullYear()} Vestal</span>
        <span class="site-footer-status">
          <span class="pulse-dot" aria-hidden="true" />
          All monitoring runs on Cloudflare's global edge
        </span>
      </div>
    </footer>
  );
}
