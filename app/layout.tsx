export const metadata = {
  title: "Fairway Card",
  description: "Track your golf scores, handicap, and stats.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0E3B2E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0E3B2E", fontFamily: "-apple-system, 'Segoe UI', Roboto, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
