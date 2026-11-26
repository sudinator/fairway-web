import { PhoneDiagnosticsRecorder } from "@/components/phone-diagnostics";
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
    // 212.132: "default", not "black-translucent". Translucent put the page UNDER the status bar, and since iOS 26 the
    // system fills that strip (and ~45–60pt below it) with its Liquid Glass scroll-edge blur, which smeared the top of
    // the Home header in the installed app (owner, Nov 26, staging and production screenshots). With "default" the web
    // view starts below the status bar, iOS paints the bar itself from theme-color (#0E3B2E, the app's green), and no
    // page pixels sit under the glass. env(safe-area-inset-top) is then 0 when installed; the shell and the viewport
    // rule (lib/viewport-height.ts: installed → innerHeight) are unchanged by that. viewport-fit=cover stays for the
    // home-indicator inset. iOS caches this value when the icon is added to the Home Screen: an existing install keeps
    // the old behaviour until the icon is removed and re-added. Nothing in CSS can switch the system effect off.
    statusBarStyle: "default",
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
    <html lang="en" data-env={isStaging ? "staging" : "production"}>
      <body data-bnn-app-shell="v1">
        {isStaging && (
          <>
            <div aria-hidden="true" style={{ position: "fixed", top: "env(safe-area-inset-top, 0px)", left: 0, right: 0, bottom: 0, border: "6px solid #FFD400", pointerEvents: "none", zIndex: 2147483646 }} />
            <div aria-hidden="true" style={{ position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 6px)", right: 10, background: "#FFD400", color: "#111", fontSize: 11, fontWeight: 800, letterSpacing: 1.4, padding: "4px 8px", borderRadius: "0 0 6px 6px", pointerEvents: "none", zIndex: 2147483647 }}>STAGING</div>
          </>
        )}
        <PhoneDiagnosticsRecorder />
        <RegisterSW />
        <ViewportSync />
        {children}
      </body>
    </html>
  );
}
