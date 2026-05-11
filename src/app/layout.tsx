import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import PWARegister from "@/components/PWARegister";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const cormorant = Cormorant_Garamond({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-cormorant",
});

export const metadata: Metadata = {
  title: "eventChart — Seating that keeps up",
  description: "A seating chart that updates in real time. Upload your floor plan, AI parses every table, guests scan a QR to find their seat.",
  manifest: "/manifest.webmanifest",
  applicationName: "eventChart",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#FBFAF7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${inter.variable} ${cormorant.variable}`}>
      <body
        className="min-h-full flex flex-col"
        style={{
          fontFamily: "var(--font-inter), ui-sans-serif, system-ui",
        }}
      >
        <style>{`
          :root {
            --font-sans: var(--font-inter), ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
            --font-serif: var(--font-cormorant), "Tiempos Headline", "Iowan Old Style", Georgia, serif;
          }
        `}</style>
        {children}
        <PWARegister />
        <Toaster
          theme="light"
          position="top-center"
          toastOptions={{
            style: {
              background: "#FFFFFF",
              border: "1px solid #E7E3DA",
              color: "#14120E",
              fontFamily: "var(--font-inter), system-ui",
              fontSize: "14px",
              borderRadius: "12px",
              padding: "10px 14px",
              boxShadow: "0 8px 24px rgba(20,18,14,0.08)",
            },
          }}
        />
      </body>
    </html>
  );
}
