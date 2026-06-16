import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata = {
  title: "PM Sim Lab — Master Project Management by Doing",
  description:
    "Learn project management by doing: realistic crisis scenarios, hands-on chart builders, AI coaching, and a certification you can share.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="light">{children}</body>
    </html>
  );
}
