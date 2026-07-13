import { RegisterSW } from "@/components/register-sw";
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
  return (
    <html lang="en">
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
