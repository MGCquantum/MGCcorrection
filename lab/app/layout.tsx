import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "QEC Research Laboratory", template: "%s · QEC Research Laboratory" },
  description: "Quantum error correction from first principles to the Gross code, on local simulation backends.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-panel focus:px-3 focus:py-2">Skip to content</a>
        <div className="mx-auto flex max-w-[1500px]">
          <Sidebar />
          <main id="main" className="min-w-0 flex-1 px-6 pb-24 pt-10 md:px-12 lg:px-16">{children}</main>
        </div>
      </body>
    </html>
  );
}
