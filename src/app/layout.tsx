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
              </main>
            </div>
            <Toaster />
          </SidebarProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
