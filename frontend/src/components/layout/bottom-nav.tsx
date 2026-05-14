"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/glot/icon";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  chip?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "My Day", icon: "home" },
  { href: "/decks", label: "Decks", icon: "layers" },
  { href: "/refinery", label: "Refinery", icon: "sparkle", chip: "AI" },
  { href: "/library", label: "Library", icon: "library" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();

  if (pathname.startsWith("/session")) {
    return null;
  }

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-start justify-around"
      style={{
        flexShrink: 0,
        height: 78,
        paddingBottom: 18,
        paddingTop: 10,
        borderTop: "1px solid var(--line)",
        background: "color-mix(in oklab, var(--bg-1) 92%, transparent)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            className="relative flex flex-col items-center"
            style={{
              gap: 4,
              color: active ? "var(--fg)" : "var(--muted)",
              padding: "4px 12px",
            }}
          >
            {active && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: -10,
                  width: 16,
                  height: 2,
                  background: "var(--accent)",
                  borderRadius: 2,
                }}
              />
            )}
            <Icon name={item.icon} size={20} />
            <span style={{ fontSize: 10, fontWeight: 500 }}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
