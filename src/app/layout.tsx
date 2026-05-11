import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import PWARegister from "@/components/PWARegister";

export const metadata: Metadata = {
  title: "eventChart — Dynamic Event Seating",
  description: "Live seating charts for event planners. Upload a floor plan, drop pins, generate QR codes — guests find their seats with one scan.",
  manifest: "/manifest.webmanifest",
  applicationName: "eventChart",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0a0b0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        {children}
        <PWARegister />
        <Toaster
          theme="dark"
          position="top-center"
          richColors
          toastOptions={{
            style: { background: "#181b25", border: "1px solid #232733", color: "#e9edf6" },
          }}
        />
      </body>
    </html>
  );
}
