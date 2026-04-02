import { createBrowserRouter, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import * as React from "react";
import { RootLayout } from "./components/layout/RootLayout";
import { RouteError } from "./components/RouteError";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Loading } from "./components/ui/Loading";

// Lazy load all route components for code splitting
// Using .then() to handle named exports from route modules
const ChatView = lazy(() => import("./routes/ChatView").then(m => ({ default: m.ChatView })));
const CodeView = lazy(() => import("./routes/CodeView").then(m => ({ default: m.CodeView })));
const AgentsView = lazy(() => import("./routes/AgentsView").then(m => ({ default: m.AgentsView })));
const AgentDetail = lazy(() => import("./routes/AgentDetail").then(m => ({ default: m.AgentDetail })));
const DocsView = lazy(() => import("./routes/DocsView").then(m => ({ default: m.DocsView })));
const SettingsView = lazy(() => import("./routes/SettingsView").then(m => ({ default: m.SettingsView })));
const NotificationsView = lazy(() => import("./routes/NotificationsView").then(m => ({ default: m.NotificationsView })));
const PersonaEditor = lazy(() => import("./routes/PersonaEditor").then(m => ({ default: m.PersonaEditor })));
const AgentWorkflow = lazy(() => import("./routes/AgentWorkflow").then(m => ({ default: m.AgentWorkflow })));

// Wrapper component to add Suspense to lazy-loaded routes
const withSuspense = (Component: React.ComponentType) => (
  <Suspense fallback={<Loading />}>
    <Component />
  </Suspense>
);

// Wrapper component to add ErrorBoundary to routes
const withErrorBoundary = (Component: React.ComponentType) => (
  <ErrorBoundary>
    {withSuspense(Component)}
  </ErrorBoundary>
);

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: "chat/:sessionId?", element: withErrorBoundary(ChatView), errorElement: <RouteError /> },
      { path: "code", element: withErrorBoundary(CodeView), errorElement: <RouteError /> },
      { path: "agents/:personaId?", element: withErrorBoundary(AgentsView), errorElement: <RouteError /> },
      { path: "agents/persona/new", element: withErrorBoundary(PersonaEditor), errorElement: <RouteError /> },
      { path: "agents/persona/edit/:personaId", element: withErrorBoundary(PersonaEditor), errorElement: <RouteError /> },
      { path: "personas/new", element: withErrorBoundary(PersonaEditor), errorElement: <RouteError /> },
      { path: "personas/:personaId/edit", element: withErrorBoundary(PersonaEditor), errorElement: <RouteError /> },
      { path: "agents/workflow/:agentId", element: withErrorBoundary(AgentDetail), errorElement: <RouteError /> },
      { path: "workflow", element: withErrorBoundary(AgentWorkflow), errorElement: <RouteError /> },
      { path: "workflow/:agentId", element: withErrorBoundary(AgentWorkflow), errorElement: <RouteError /> },
      { path: "docs", element: withErrorBoundary(DocsView), errorElement: <RouteError /> },
      { path: "settings", element: withErrorBoundary(SettingsView), errorElement: <RouteError /> },
      { path: "notifications", element: withErrorBoundary(NotificationsView), errorElement: <RouteError /> },
    ],
  },
]);
