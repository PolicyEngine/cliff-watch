import { PolicyEngineShell } from "@policyengine/ui-kit/layout";
import "@policyengine/ui-kit/styles.css";

import { Inter } from "next/font/google";
import "./globals.css";
import PolicyEngineHeader from "../src/components/PolicyEngineHeader";

const inter = Inter({ subsets: ["latin"] });
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata = {
  title: "Cliff Watch",
  description: "PolicyEngine benefit cliff explorer",
  icons: {
    icon: `${basePath}/favicon.svg`,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <PolicyEngineShell country="us">
        <PolicyEngineHeader />
        {children}
              </PolicyEngineShell>
      </body>
    </html>
  );
}
