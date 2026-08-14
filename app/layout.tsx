import { RegisterSW } from "@/components/register-sw";
import { ViewportSync } from "@/components/viewport-sync";
import "./globals.css";

export const metadata = {
  title: "Birdie Num Num",
  description: "Track your golf scores, handicap, and stats.",
  manifest: "/manifest.webmanifest",
  applicationName: "Birdie Num Num",
  appleWebApp: {
    capable: true,
    title: "Birdie Num Num",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0E3B2E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isStaging = process.env.VERCEL_GIT_COMMIT_REF === "staging";

  return (
    <html lang="en">
      <body>
        {isStaging && (
          <>
            <div aria-hidden="true" style={{ position: "fixed", top: "env(safe-area-inset-top, 0px)", left: 0, right: 0, bottom: 0, border: "6px solid #FFD400", pointerEvents: "none", zIndex: 2147483646 }} />
            <div aria-hidden="true" style={{ position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 6px)", right: 10, background: "#FFD400", color: "#111", fontSize: 11, fontWeight: 900, letterSpacing: 1.4, padding: "4px 8px", borderRadius: "0 0 6px 6px", pointerEvents: "none", zIndex: 2147483647 }}>STAGING</div>
          </>
        )}
        <RegisterSW />
        <ViewportSync />
        {children}
      </body>
    </html>
  );
}
