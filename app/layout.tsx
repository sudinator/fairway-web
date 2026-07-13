import { RegisterSW } from "@/components/register-sw";

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
  return (
    <html lang="en" style={{ height: "100%", overflow: "hidden" }}>
      <body style={{ margin: 0, position: "fixed", inset: 0, overflow: "hidden", overscrollBehavior: "none", background: "#0E3B2E", fontFamily: "-apple-system, 'Segoe UI', Roboto, sans-serif", paddingTop: "env(safe-area-inset-top)" }}>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
