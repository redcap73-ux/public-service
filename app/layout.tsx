import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "안녕하세요",
  description: "간단한 Next.js 페이지",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
