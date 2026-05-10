import { Inter } from "next/font/google";
import "./globals.css";
import PolicyEngineHeader from "../src/components/PolicyEngineHeader";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Cliff Watch",
  description: "PolicyEngine benefit cliff explorer",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <PolicyEngineHeader />
        {children}
      </body>
    </html>
  );
}
