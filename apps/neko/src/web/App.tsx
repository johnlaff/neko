import { useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  lazyRouteComponent,
  Outlet,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { Fragment, lazy, Suspense, useEffect } from "react";
import { api } from "./api.ts";
import { readAtLabel } from "./format.ts";
import {
  IconCard,
  IconEye,
  IconEyeOff,
  IconMonth,
  IconRefresh,
  IconSettings,
  IconToday,
} from "./icons.tsx";
import { toggleValues, useValuesHidden } from "./privacy.ts";
import { syncPush } from "./Reminders.tsx";
import { reportError } from "./report.ts";
import { Hoje } from "./screens/Hoje.tsx";
import { ErrorBlock, Skeleton, useProjection } from "./useProjection.tsx";

// Hoje is where the app opens; the other screens load on their own and are fetched while the
// phone is idle, so switching tabs never waits on the network.
const screens = {
  faturas: () => import("./screens/Faturas.tsx"),
  mes: () => import("./screens/Mes.tsx"),
  ajustes: () => import("./screens/Ajustes.tsx"),
};
const prefetchScreens = () => {
  const run = () => {
    for (const load of Object.values(screens)) load().catch(() => {});
  };
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
};

// Signing in happens once per device, so its WebAuthn code loads only when the login shows.
const Login = lazy(() => import("./Login.tsx").then((m) => ({ default: m.Login })));

const TITLES: Record<string, string> = {
  "/": "Hoje",
  "/faturas": "Faturas",
  "/mes": "Mês",
  "/ajustes": "Ajustes",
};

/**
 * The screen's name, when the sheet was read and a way to read it again: the same head as the
 * Android app, on every screen. The brand lives in the icon and the tab, not over every screen.
 */
const Masthead = () => {
  const q = useProjection();
  const hidden = useValuesHidden();
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <header className="masthead">
      <div className="masthead-title">
        <h1>{TITLES[path] ?? "Neko"}</h1>
        {q.data && (
          <p className={q.data.offline ? "read warn" : "read"} role="status">
            {q.data.offline ? "Sem conexão · Lida" : "Planilha lida"}{" "}
            {readAtLabel(q.data.sheet.readAt)}
          </p>
        )}
      </div>
      <button
        type="button"
        className="icon"
        onClick={toggleValues}
        aria-pressed={hidden}
        aria-label="Esconder valores"
      >
        {hidden ? <IconEyeOff /> : <IconEye />}
      </button>
      <button
        type="button"
        className={`icon${q.isFetching ? " spinning" : ""}`}
        onClick={() => q.refetch()}
        disabled={q.isFetching}
        aria-label={q.isFetching ? "Lendo a planilha" : "Ler a planilha de novo"}
      >
        <IconRefresh />
      </button>
    </header>
  );
};

const Shell = () => {
  // Amounts are formatted while rendering, so the screen remounts when values hide or show.
  const hidden = useValuesHidden();
  useEffect(prefetchScreens, []);
  useEffect(syncPush, []);
  return (
    <>
      <main className="page">
        <Masthead />
        <Fragment key={hidden ? "hidden" : "shown"}>
          <Outlet />
        </Fragment>
      </main>
      <nav className="dock" aria-label="Telas">
        <Link to="/" activeOptions={{ exact: true }}>
          <IconToday />
          Hoje
        </Link>
        <Link to="/faturas">
          <IconCard />
          Faturas
        </Link>
        <Link to="/mes">
          <IconMonth />
          Mês
        </Link>
        <Link to="/ajustes">
          <IconSettings />
          Ajustes
        </Link>
      </nav>
    </>
  );
};

const rootRoute = createRootRoute({ component: Shell });
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: Hoje }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/faturas",
    component: lazyRouteComponent(screens.faturas, "Faturas"),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/mes",
    // ?m=2026-11 opens that month, so a warning can point straight at it.
    validateSearch: (s: Record<string, unknown>): { m?: string } =>
      typeof s.m === "string" && /^\d{4}-\d{2}$/.test(s.m) ? { m: s.m } : {},
    component: lazyRouteComponent(screens.mes, "Mes"),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/ajustes",
    component: lazyRouteComponent(screens.ajustes, "Ajustes"),
  }),
]);
// A screen that breaks says so in the app's words and offers a way out, not a stack trace.
function ScreenError({ error, reset }: { error: unknown; reset: () => void }) {
  useEffect(() => reportError(error), [error]);
  return (
    <ErrorBlock
      title="Esta tela travou"
      text="A planilha não foi alterada. Recarregar costuma resolver."
      retry={() => {
        reset();
        window.location.reload();
      }}
    />
  );
}

const router = createRouter({
  routeTree,
  defaultPendingComponent: Skeleton,
  defaultErrorComponent: ScreenError,
  // Tabs slide toward where they sit in the dock; browsers without View Transitions just swap.
  defaultViewTransition: true,
});

const TAB_ORDER = ["/", "/faturas", "/mes", "/ajustes"];
router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
  const from = TAB_ORDER.indexOf(fromLocation?.pathname ?? "/");
  const to = TAB_ORDER.indexOf(toLocation.pathname);
  document.documentElement.dataset.nav = to >= from ? "forward" : "back";
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export const App = () => {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  if (me.isPending)
    return (
      <main className="page">
        <Skeleton />
      </main>
    );
  if (!me.data?.email)
    return (
      <Suspense fallback={<main className="center login" />}>
        <Login />
      </Suspense>
    );
  return <RouterProvider router={router} />;
};
