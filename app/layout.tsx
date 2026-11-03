import type { Metadata } from "next";
import "./globals.css";
import "./legacy-nav.css";
import "./auth.css";

export const metadata: Metadata = {
  title: "Best Publishers POS",
  description: "Books billing and inventory system",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
