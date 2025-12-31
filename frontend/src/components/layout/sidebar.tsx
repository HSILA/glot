"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Library, FlaskConical, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { href: "/", label: "My Day", icon: Home },
  { href: "/library", label: "Library", icon: Library },
  { href: "/refinery", label: "Refinery", icon: FlaskConical },
  { href: "/decks", label: "Decks", icon: Layers },
];

export function Sidebar() {
  const pathname = usePathname();

  const renderNavItem = (item: NavItem) => {
    const isActive =
      pathname === item.href ||
      (item.href !== "/" && pathname.startsWith(item.href));

    return (
      <Tooltip key={item.href}>
        <TooltipTrigger asChild>
          <Link href={item.href}>
            <Button
              variant={isActive ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-3 h-11 px-4",
                isActive &&
                  "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              )}
            >
              <item.icon
                className={cn(
                  "h-5 w-5",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              />
              <span>{item.label}</span>
            </Button>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="md:hidden">
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <aside className="hidden md:flex md:w-64 lg:w-72 flex-col h-screen fixed left-0 top-0 border-r border-sidebar-border bg-sidebar">
      {/* Logo */}
      <div className="p-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg">
            <span className="text-primary-foreground font-bold text-xl">G</span>
          </div>
          <span className="font-semibold text-xl tracking-tight">Glot</span>
        </Link>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        <TooltipProvider delayDuration={0}>
          {navItems.map((item) => renderNavItem(item))}
        </TooltipProvider>
      </nav>
    </aside>
  );
}
