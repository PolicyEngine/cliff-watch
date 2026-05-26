"use client";

import dynamic from "next/dynamic";

// Lazy-load the interactive app (which pulls in recharts and the wizard) so
// the initial document is small and chart code only ships when the user
// reaches the page. ssr is false because the app uses browser-only APIs
// (window, navigator.clipboard) and the project is a static export.
const App = dynamic(() => import("../src/App.jsx"), {
  ssr: false,
  loading: () => (
    <div
      className="app-loading"
      style={{
        padding: "48px 24px",
        textAlign: "center",
        color: "#475569",
        fontSize: 14,
      }}
    >
      Loading CliffWatch…
    </div>
  ),
});

export default function ClientApp() {
  return <App />;
}
