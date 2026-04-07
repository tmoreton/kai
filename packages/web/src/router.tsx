import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { RootLayout } from "./components/layout/RootLayout";
import { RouteError } from "./components/RouteError";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useSuspenseQuery } from "@tanstack/react-query";
import { settingsQueries } from "./api/queries";

// Import all routes directly (no lazy loading) to prevent chunk loading errors
import { ChatView } from "./routes/ChatView";
import { CodeView } from "./routes/CodeView";
import { AgentsView } from "./routes/AgentsView";
import { AgentDetail } from "./routes/AgentDetail";
import { SettingsView } from "./routes/SettingsView";
import { NotificationsView } from "./routes/NotificationsView";
import { AgentEditor } from "./routes/AgentEditor";
import { DocsView } from "./routes/DocsView";
import { WorkflowView } from "./routes/WorkflowView";
import { LandingPage } from "./routes/LandingPage";
import { Onboarding } from "./routes/Onboarding";

// Wrapper component to add ErrorBoundary to routes
const withErrorBoundary = (Component: React.ComponentType) => (
  <ErrorBoundary>
    <Component />
  </ErrorBoundary>
);

// Onboarding check wrapper - redirects to onboarding if no API key
function OnboardingCheck() {
  const { data: envData } = useSuspenseQuery({
    ...settingsQueries.env(),
    staleTime: 0,
  });

  const hasOpenRouterKey = !!envData.env.OPENROUTER_API_KEY;
  
  if (!hasOpenRouterKey) {
    return <Onboarding />;
  }
  
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <OnboardingCheck />,
    errorElement: <RouteError />,
    children: [
      {
        element: <RootLayout />,
        children: [
          { index: true, element: <Navigate to="/chat" replace /> },
          { path: "chat/:sessionId?", element: withErrorBoundary(ChatView), errorElement: <RouteError /> },
          { path: "code", element: withErrorBoundary(CodeView), errorElement: <RouteError /> },
          { path: "agents", element: withErrorBoundary(AgentsView), errorElement: <RouteError /> },
          { path: "agents/:agentId", element: withErrorBoundary(AgentDetail), errorElement: <RouteError /> },
          { path: "agents/new", element: withErrorBoundary(AgentEditor), errorElement: <RouteError /> },
          { path: "agents/:agentId/edit", element: withErrorBoundary(AgentEditor), errorElement: <RouteError /> },
          { path: "settings", element: withErrorBoundary(SettingsView), errorElement: <RouteError /> },
          { path: "notifications", element: withErrorBoundary(NotificationsView), errorElement: <RouteError /> },
          { path: "docs", element: withErrorBoundary(DocsView), errorElement: <RouteError /> },
          { path: "workflows", element: withErrorBoundary(WorkflowView), errorElement: <RouteError /> },
          { path: "workflows/:workflowId", element: withErrorBoundary(WorkflowView), errorElement: <RouteError /> },
        ],
      },
    ],
  },
  // Onboarding route accessible directly
  {
    path: "/setup",
    element: <Onboarding />,
    errorElement: <RouteError />,
  },
  // Landing page at separate route - not default
  {
    path: "/landing",
    element: <LandingPage />,
    errorElement: <RouteError />,
  },
]);
