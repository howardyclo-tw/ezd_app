import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";

export const metadata: Metadata = {
  title: "EZD App - 熱舞社管理系統",
  description: "熱舞社管理系統 - Dance Club Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Header />
          <main className="container mx-auto px-4 pb-20 md:pb-4">
            {children}
          </main>
          <MobileNav />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

