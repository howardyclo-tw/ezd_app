import { createClient, getServerProfile } from "@/lib/supabase/server";
import { RoleProvider } from "@/components/providers/role-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Header } from "@/components/layout/header";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "EZDANCE - 熱舞社管理系統",
  description: "熱舞社管理系統 - Dance Club Management System",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fetch initial role for context (cached across request)
  const { user, profile } = await getServerProfile();

  const initialRole = profile?.role || 'guest';
  const initialName = profile?.name || '';

  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-screen bg-background font-sans antialiased">
        <RoleProvider initialRole={initialRole} initialName={initialName}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
          >
            <Header />
            <main className="mx-auto w-full max-w-5xl px-4 pb-20 md:pb-4">
              {children}
            </main>
            <MobileNav />
            <Toaster />
          </ThemeProvider>
        </RoleProvider>
      </body>
    </html>
  );
}

