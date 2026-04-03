import { createBrowserRouter, Navigate } from "react-router-dom";
import { RootLayout } from "./components/layout/RootLayout";
import { RouteError } from "./components/RouteError";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Import all routes directly (no lazy loading) to prevent chunk loading errors
import { ChatView } from "./routes/ChatView";
import { CodeView } from "./routes/CodeView";
import { AgentsView } from "./routes/AgentsView";
import { AgentDetail } from "./routes/AgentDetail";
import { SettingsView } from "./routes/SettingsView";
import { NotificationsView } from "./routes/NotificationsView";
import { PersonaEditor } from "./routes/PersonaEditor";
import { DocsView } from "./routes/DocsView";
import { WorkflowView } from "./routes/WorkflowView";

// Wrapper component to add ErrorBoundary to routes
const withErrorBoundary = (Component: React.ComponentType) => (
  <ErrorBoundary>
    <Component />
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
      { path: "agents", element: withErrorBoundary(AgentsView), errorElement: <RouteError /> },
      { path: "agents/:personaId", element: withErrorBoundary(AgentDetail), errorElement: <RouteError /> },
      { path: "agents/persona/new", element: withErrorBoundary(PersonaEditor), errorElement: <RouteError /> },
      { path: "agents/persona/edit/:personaId", element: withErrorBoundary(PersonaEditor), errorElement: <RouteError /> },
      { path: "personas/new", element: withErrorBoundary(PersonaEditor), errorElement: <RouteError /> },
      { path: "personas/:personaId/edit", element: withErrorBoundary(PersonaEditor), errorElement: <RouteError /> },
      { path: "settings", element: withErrorBoundary(SettingsView), errorElement: <RouteError /> },
      { path: "notifications", element: withErrorBoundary(NotificationsView), errorElement: <RouteError /> },
      { path: "docs", element: withErrorBoundary(DocsView), errorElement: <RouteError /> },
      { path: "workflows", element: withErrorBoundary(WorkflowView), errorElement: <RouteError /> },
      { path: "workflows/:workflowId", element: withErrorBoundary(WorkflowView), errorElement: <RouteError /> },
    ],
  },
]);
