import type { Metadata } from "next";
import { Sorts_Mill_Goudy } from "next/font/google";
import "./globals.css";

const goudy = Sorts_Mill_Goudy({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], display: "swap", variable: "--font-goudy" });

export const metadata: Metadata = { title: "Online Assessment", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={goudy.variable}>
      <body>{children}</body>
    </html>
  );
}
