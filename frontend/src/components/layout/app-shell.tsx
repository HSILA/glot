"use client";

import * as React from "react";
import { Sidebar } from "./sidebar";
import { BottomNav } from "./bottom-nav";
import { Header } from "./header";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      {/* Main Content Area — offset matches the sidebar width so collapsing
          recenters the content. Mobile (< md) has no offset; bottom-nav owns it. */}
      <div
        className={cn(
          "flex flex-col h-screen overflow-hidden transition-[padding] duration-200 ease-[ease]",
          collapsed ? "md:pl-16" : "md:pl-60"
        )}
      >
        <Header />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pb-20 md:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <BottomNav />
    </div>
  );
}
