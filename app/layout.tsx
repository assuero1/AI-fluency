import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import { ButtonFeedback } from "@/components/ButtonFeedback";
import { PwaRegistration } from "@/components/PwaRegistration";

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Talkkito",
  description: "PWA mobile-first para aprendizado de linguas com IA.",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Talkkito"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#58cc02"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={nunito.variable}>
        {children}
        <ButtonFeedback />
        <PwaRegistration />
      </body>
    </html>
  );
}
