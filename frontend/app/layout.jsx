import { PolicyEngineShell } from "@policyengine/ui-kit/layout";
import "@policyengine/ui-kit/styles.css";
import "policyengine-household-wizard/styles.css";

import { Inter } from "next/font/google";
import "./globals.css";
const inter = Inter({ subsets: ["latin"] });
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const CANONICAL_URL = "https://policyengine.org/us/cliffwatch";
const OG_IMAGE = "https://policyengine.org/us/cliffwatch/cliffwatch-og.png";

const TITLE = "CliffWatch — PolicyEngine benefit cliff explorer";
const DESCRIPTION =
  "CliffWatch maps benefit cliffs and marginal tax rates by household: see how SNAP, TANF, EITC, CTC, Medicaid, CHIP, ACA, housing, and child care benefits change as wages rise across all 50 US states.";

export const metadata = {
  metadataBase: new URL("https://policyengine.org"),
  title: {
    default: TITLE,
    template: "%s | CliffWatch",
  },
  description: DESCRIPTION,
  applicationName: "CliffWatch",
  keywords: [
    "benefit cliff",
    "marginal tax rate",
    "MTR",
    "SNAP",
    "EITC",
    "CTC",
    "Medicaid",
    "CHIP",
    "ACA",
    "TANF",
    "WIC",
    "Section 8",
    "housing voucher",
    "child care subsidy",
    "tax credits",
    "PolicyEngine",
    "US benefits",
    "income support",
    "welfare cliff",
  ],
  authors: [{ name: "PolicyEngine", url: "https://policyengine.org" }],
  creator: "PolicyEngine",
  publisher: "PolicyEngine",
  category: "Public policy",
  alternates: {
    canonical: CANONICAL_URL,
  },
  openGraph: {
    type: "website",
    url: CANONICAL_URL,
    siteName: "PolicyEngine",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "CliffWatch — PolicyEngine benefit cliff explorer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@PolicyEngine",
    creator: "@PolicyEngine",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: `${basePath}/favicon.svg`, type: "image/svg+xml" },
    ],
    apple: [{ url: `${basePath}/favicon.svg` }],
  },
  manifest: `${basePath}/manifest.webmanifest`,
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2C7A7B",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "CliffWatch",
  alternateName: "PolicyEngine CliffWatch",
  url: CANONICAL_URL,
  description: DESCRIPTION,
  applicationCategory: "FinanceApplication",
  operatingSystem: "All",
  browserRequirements: "Requires JavaScript and modern web browser",
  isAccessibleForFree: true,
  inLanguage: "en-US",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  publisher: {
    "@type": "Organization",
    name: "PolicyEngine",
    url: "https://policyengine.org",
    logo: {
      "@type": "ImageObject",
      url: "https://policyengine.org/policyengine-logo.png",
    },
  },
  audience: {
    "@type": "Audience",
    audienceType:
      "Policy researchers, social workers, journalists, and households",
  },
  featureList: [
    "Plot net household income against wages for any US household",
    "Identify benefit cliffs and dead zones",
    "Visualize marginal tax rates across the income distribution",
    "Break down individual program contributions (SNAP, EITC, Medicaid, CHIP, ACA, TANF, WIC, housing, child care)",
    "All 50 US states and Washington, DC",
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={inter.className}>
        <PolicyEngineShell country="us">
          {children}
        </PolicyEngineShell>
      </body>
    </html>
  );
}
