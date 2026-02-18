import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { RoleProvider } from "@/components/providers/role-provider";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "EZD App - 熱舞社管理系統",
  description: "熱舞社管理系統 - Dance Club Management System",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fetch initial role for context
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let initialRole = 'guest';
  let initialName = '';

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, name')
      .eq('id', user.id)
      .maybeSingle();
    initialRole = profile?.role || 'guest';
    initialName = profile?.name || '';
  }

  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <RoleProvider initialRole={initialRole} initialName={initialName}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
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

