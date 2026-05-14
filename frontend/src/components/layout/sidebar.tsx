"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/glot/wordmark";
import { Icon, type IconName } from "@/components/glot/icon";
import { useAuth } from "@/components/providers/auth-provider";
import { cn } from "@/lib/utils";

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

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const { user } = useAuth();

  const width = collapsed ? 64 : 240;

  const initials = React.useMemo(() => {
    if (!user) return "G";
    if (user.display_name) {
      return user.display_name
        .split(" ")
        .map((w) => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();
    }
    return user.email.slice(0, 2).toUpperCase();
  }, [user]);

  return (
    <aside
      className="hidden md:flex flex-col fixed left-0 top-0 h-screen overflow-hidden"
      style={{
        width,
        minWidth: width,
        maxWidth: width,
        background: "var(--bg-1)",
        borderRight: "1px solid var(--line)",
        transition: "width .2s ease, min-width .2s ease, max-width .2s ease",
        flexShrink: 0,
        zIndex: 30,
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center"
        style={{
          padding: collapsed ? "22px 12px 16px" : "22px 20px 16px",
        }}
      >
        <Link
          href="/"
          aria-label="Glot home"
          className="flex items-center w-full"
          style={{ justifyContent: collapsed ? "center" : "flex-start" }}
        >
          {collapsed ? <Wordmark size={20} showText={false} /> : <Wordmark size={20} />}
        </Link>
      </div>

      {/* Nav */}
      <nav
        className="flex flex-col"
        style={{
          padding: collapsed ? "8px 8px" : "8px 12px",
          gap: 2,
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className="relative flex items-center"
              style={{
                padding: collapsed ? "10px 0" : "10px 12px",
                gap: 12,
                borderRadius: 8,
                background: active ? "var(--surface-1)" : "transparent",
                color: active ? "var(--fg)" : "var(--muted)",
                fontWeight: 500,
                fontSize: 14,
                justifyContent: collapsed ? "center" : "flex-start",
                textAlign: "left",
              }}
            >
              {active && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: collapsed ? 0 : -12,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    background: "var(--accent)",
                    borderRadius: 2,
                  }}
                />
              )}
              <Icon name={item.icon} size={17} />
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {!collapsed && item.chip && (
                <span
                  className="mono"
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    padding: "2px 5px",
                    borderRadius: 3,
                    background: "var(--accent)",
                    color: "var(--accent-fg)",
                  }}
                >
                  {item.chip}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="grid place-items-center"
        style={{
          position: "absolute",
          right: -12,
          top: 72,
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          color: "var(--muted)",
          zIndex: 10,
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          cursor: "pointer",
        }}
      >
        <Icon name={collapsed ? "chev" : "arrowL"} size={12} />
      </button>

      {/* Bottom section */}
      <div
        className={cn("mt-auto")}
        style={{
          padding: collapsed ? 8 : 16,
          borderTop: "1px solid var(--line)",
        }}
      >
        {!collapsed ? (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: "var(--surface)",
              border: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #c5a3ff, #88d4ff)",
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 600,
                color: "#0a0a0b",
              }}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user?.display_name || user?.email || "Guest"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Free plan</div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center" style={{ gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #c5a3ff, #88d4ff)",
                display: "grid",
                placeItems: "center",
                fontSize: 10,
                fontWeight: 600,
                color: "#0a0a0b",
              }}
            >
              {initials}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export const SIDEBAR_DEFAULT_WIDTH = 240;
