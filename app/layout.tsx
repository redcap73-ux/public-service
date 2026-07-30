import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "고객동의 시스템",
  description: "고객 동의 및 인증 절차를 진행하는 시스템입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
