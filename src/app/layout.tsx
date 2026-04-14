import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Handai - AI Data Suite",
  description: "AI-Powered Data Transformation & Qualitative Analysis Suite",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <TooltipProvider>
          <SidebarProvider>
            <div className="flex min-h-screen w-full">
              <AppSidebar />
              <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto">
                <div className="flex h-14 items-center border-b px-4 flex-wrap gap-2">
                  <SidebarTrigger />
                  <div className="ml-4 font-semibold">Handai AI Data Suite</div>
                </div>
                <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
                  {children}
                </div>
                <footer className="border-t px-4 sm:px-6 lg:px-8 py-6 mt-auto">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
                    <div className="text-center sm:text-left">
                      <span className="font-semibold text-foreground">Handai</span> v1.1 &middot; Created by{" "}
                      <a href="https://saqr.me" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">
                        Prof. Mohammed Saqr, PhD
                      </a>
                      <br className="sm:hidden" />
                      <span className="hidden sm:inline"> &middot; </span>
                      Professor of Computer Science &middot; University of Eastern Finland
                    </div>
                    <div className="text-center sm:text-right whitespace-nowrap">
                      &copy; 2026 All rights reserved &middot; Last updated April 2026
                    </div>
                  </div>
                </footer>
              </main>
            </div>
            <Toaster />
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
