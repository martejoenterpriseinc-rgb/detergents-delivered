import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { connection } from "next/server";
import { integrationEnvironment } from "@/lib/integration-environment";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Detergents Delivered",
    template: "%s · Detergents Delivered",
  },
  description:
    "Household detergents and everyday essentials, delivered on your schedule.",
  applicationName: "Detergents Delivered",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/brand/logo.png",
    apple: "/brand/logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0F766E",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Resolve from the running service, never bake the build machine's mode into HTML.
  await connection();
  const mode = integrationEnvironment();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-environment={mode ?? "unknown"}
    >
      <body className="bg-background text-foreground min-h-full font-sans">
        <ServiceWorkerRegister />
        {mode !== "live" && (
          <div className="environment-bar" role="note" aria-label="Current environment">
            {mode === "sandbox"
              ? "SANDBOX — You are in the test environment"
              : "Environment not configured — connections blocked"}
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
