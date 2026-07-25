import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useAuth } from "./context/auth";
import { useRouter, Route, Switch } from "./router";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Pricing } from "./pages/Pricing";
import { Docs } from "./pages/Docs";
import { Security } from "./pages/Security";
import { About } from "./pages/About";
import { ForMSPs } from "./pages/ForMSPs";
import { Changelog } from "./pages/Changelog";
import { TestResticRestore } from "./pages/articles/TestResticRestore";
import { CompareChecks } from "./pages/articles/CompareChecks";
import { ThreeTwoOneRule } from "./pages/articles/ThreeTwoOneRule";
import { ExitCodeZero } from "./pages/articles/ExitCodeZero";
import { Privacy, Refunds, Terms } from "./pages/Legal";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { VerifyEmail } from "./pages/VerifyEmail";
import { Dashboard } from "./pages/Dashboard";
import { Organizations } from "./pages/Organizations";
import { NotFound } from "./pages/NotFound";

function RequireAuth({ children }: { children: ComponentChildren }) {
  const { user, loading } = useAuth();
  const { navigate } = useRouter();

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, user, navigate]);

  if (loading) return <p class="loading-state">Loading…</p>;
  if (!user) return null; // redirect effect above is about to fire
  return <>{children}</>;
}

/**
 * Redirects a visitor who's *already* logged in away from /login or
 * /signup — but only based on the auth state at the moment this page was
 * loaded, checked exactly once. It deliberately does NOT keep reacting to
 * `user` afterward: signing up successfully also sets `user` (the session
 * cookie is issued immediately), and a naive version of this guard that
 * watches `user` reactively would unmount the Signup page — including its
 * one-time API key reveal screen — the instant that happens, yanking the
 * user to /dashboard before they ever see their key. That was a real bug
 * caught by an actual headless-browser test clicking through the flow;
 * curl-level API testing had no way to catch it, since it only exists in
 * the interaction between routing and component lifecycle.
 */
function RedirectIfAuthed({ children }: { children: ComponentChildren }) {
  const { user, loading } = useAuth();
  const { navigate } = useRouter();
  const [checked, setChecked] = useState(false);
  const wasAuthedOnLoad = useRef(false);

  useEffect(() => {
    if (loading || checked) return;
    wasAuthedOnLoad.current = user !== null;
    setChecked(true);
    if (user) navigate("/dashboard", { replace: true });
    // Deliberately excludes `user`/`navigate` from deps beyond this one
    // check — see the doc comment above for why this must not re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, checked]);

  if (!checked) return <p class="loading-state">Loading…</p>;
  if (wasAuthedOnLoad.current) return null;
  return <>{children}</>;
}

/** Full-bleed routes: everything except the dashboard, which keeps the
 * classic centered app column. Marketing pages and auth manage their own
 * width via .container / .auth-shell. */
const BLEED_PATHS = new Set([
  "/", "/pricing", "/docs", "/security", "/about", "/changelog", "/msp",
  "/privacy", "/terms", "/articles/test-restic-backup-restores", "/articles/compare-check-commands",
  "/articles/3-2-1-backup-rule-home-nas", "/articles/exit-code-0-is-not-enough",
  "/login", "/signup", "/forgot-password", "/reset-password", "/verify-email",
]);

export function App() {
  const { path } = useRouter();
  const bleed = BLEED_PATHS.has(path);

  return (
    <Layout bleed={bleed}>
      <Switch>
        <Route path="/">
          <Home />
        </Route>
        <Route path="/pricing">
          <Pricing />
        </Route>
        <Route path="/docs">
          <Docs />
        </Route>
        <Route path="/security">
          <Security />
        </Route>
        <Route path="/about">
          <About />
        </Route>
        <Route path="/msp">
          <ForMSPs />
        </Route>
        <Route path="/changelog">
          <Changelog />
        </Route>
        <Route path="/articles/test-restic-backup-restores">
          <TestResticRestore />
        </Route>
        <Route path="/articles/compare-check-commands">
          <CompareChecks />
        </Route>
        <Route path="/articles/3-2-1-backup-rule-home-nas">
          <ThreeTwoOneRule />
        </Route>
        <Route path="/articles/exit-code-0-is-not-enough">
          <ExitCodeZero />
        </Route>
        <Route path="/privacy">
          <Privacy />
        </Route>
        <Route path="/terms">
          <Terms />
        </Route>
        <Route path="/refund">
          <Refunds />
        </Route>
        <Route path="/login">
          <RedirectIfAuthed>
            <Login />
          </RedirectIfAuthed>
        </Route>
        <Route path="/signup">
          <RedirectIfAuthed>
            <Signup />
          </RedirectIfAuthed>
        </Route>
        <Route path="/forgot-password">
          <ForgotPassword />
        </Route>
        <Route path="/reset-password">
          <ResetPassword />
        </Route>
        <Route path="/verify-email">
          <VerifyEmail />
        </Route>
        <Route path="/dashboard">
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        </Route>
        <Route path="/organizations">
          <RequireAuth>
            <Organizations />
          </RequireAuth>
        </Route>
        <Route path="*">
          <NotFound />
        </Route>
      </Switch>
    </Layout>
  );
}
