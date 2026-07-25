import { useEffect } from "preact/hooks";

/**
 * Per-route <title> and meta description. index.html ships one generic
 * pair for the raw HTML payload (crawlers that don't execute JS, and the
 * instant they see before hydration) — every route was silently reusing
 * that same title/description with nothing here to override it, so every
 * page on the site looked identical to search engines and to a browser
 * tab. Google's indexer does execute JS before indexing, so setting these
 * on mount is a real, indexable improvement, just a second-wave one; true
 * per-route static HTML (prerendering/SSR) would be strictly better and is
 * tracked as a follow-up, not done here.
 */
export interface PageMeta {
  title: string;
  description: string;
}

const SITE_TITLE_SUFFIX = " | Vestal";

/**
 * Set (never read back client-side) by `usePageMeta` when it runs during
 * prerendering (`web/scripts/prerender.tsx`), where there's no `document`
 * to mutate: the prerender script reads this synchronously right after
 * `renderToString` returns, since a function component's body (including
 * this branch) runs top-to-bottom during that call even though the
 * `useEffect` below never actually fires outside a real browser. Kept as
 * the one source of truth for per-route title/description so prerendering
 * can't silently drift from what each page already declares.
 */
export let lastSsrMeta: PageMeta | null = null;

/** Exported because `lastSsrMeta`'s binding can't be reassigned from
 * outside this module (ES module `let` exports are read-only live
 * bindings to importers): the prerender script calls this between routes
 * so a page that forgot to call `usePageMeta` fails loudly instead of
 * silently inheriting the previous route's title. */
export function resetSsrMeta() {
  lastSsrMeta = null;
}

/**
 * Shared by both the client-side hook and the prerender script so they
 * can never compute two different titles for the same route. Skips the
 * suffix whenever the page's own title already mentions "Vestal" anywhere
 * (not just an exact-match special case): About/ForMSPs/Home/Pricing/
 * Security all write their own "Vestal" into the title for good reason
 * (brand-first on the homepage, "About Vestal" reading naturally, etc.),
 * and an exact-match-only check let every one of those come out doubled
 * ("Pricing | Vestal backup verification | Vestal") in production.
 */
export function fullPageTitle(title: string): string {
  return title.toLowerCase().includes("vestal") ? title : `${title}${SITE_TITLE_SUFFIX}`;
}

function setMetaDescription(content: string) {
  let tag = document.querySelector('meta[name="description"]');
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", "description");
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function setOgMeta(property: string, content: string) {
  let tag = document.querySelector(`meta[property="${property}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("property", property);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

/** origin + pathname only — deliberately drops query string and hash, so a
 * tracking param or same-page anchor never registers as a distinct
 * canonical URL from the plain route. */
function setCanonical(href: string) {
  let tag = document.querySelector('link[rel="canonical"]');
  if (!tag) {
    tag = document.createElement("link");
    tag.setAttribute("rel", "canonical");
    document.head.appendChild(tag);
  }
  tag.setAttribute("href", href);
}

export function usePageMeta(meta: PageMeta) {
  if (typeof document === "undefined") {
    lastSsrMeta = meta;
  }
  useEffect(() => {
    const fullTitle = fullPageTitle(meta.title);
    const canonicalUrl = `${window.location.origin}${window.location.pathname}`;
    document.title = fullTitle;
    setMetaDescription(meta.description);
    setOgMeta("og:title", fullTitle);
    setOgMeta("og:description", meta.description);
    setOgMeta("og:url", canonicalUrl);
    setCanonical(canonicalUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.title, meta.description]);
}
