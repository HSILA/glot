"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { parseApiError } from "@/lib/api-error";
import {
  buildLoginUrl,
  fetchWithAuth,
  isSafeNext,
} from "@/lib/api/fetch-with-auth";

interface User {
  id: number;
  email: string;
  display_name: string | null;
  is_active: boolean;
  joined_at: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PUBLIC_PATHS = ["/login", "/register"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  const refreshUser = useCallback(async (): Promise<void> => {
    try {
      // fetchWithAuth will transparently try /auth/refresh on a 401 before
      // surfacing the failure to us, so an expired access token alone does
      // not log the user out.
      const response = await fetchWithAuth("/api/v1/auth/me", {
        redirectOnAuthFailure: false,
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        return;
      }

      // Still 401 after a refresh attempt → genuinely logged out. The
      // backend's /auth/refresh clears auth cookies on failure, so the
      // proxy middleware won't bounce us off /login.
      setUser(null);
    } catch {
      // Network / parse error — treat as logged out so the UI does not get
      // stuck on a stale user.
      setUser(null);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(parseApiError(data));
    }

    await refreshUser();
    // Navigation is handled by the redirect effect below, which honours
    // `next` from the URL.
  };

  const logout = async () => {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore network errors; we still want to clear local state.
    }
    setUser(null);
    router.push("/login");
  };

  // Check auth status on mount. The first /auth/me hit may 401 if the
  // access token has expired — fetchWithAuth will refresh once before we
  // give up, so a valid refresh token alone is enough to stay signed in.
  useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
      await refreshUser();
      setIsLoading(false);
    };

    void checkAuth();
  }, [refreshUser]);

  // Redirect logic — preserve where the user was trying to go.
  useEffect(() => {
    if (isLoading) return;

    if (!user && !isPublicPath) {
      const target = buildLoginUrl(pathname);
      router.replace(target);
      return;
    }

    if (user && isPublicPath) {
      const nextParam =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("next")
          : null;
      router.replace(isSafeNext(nextParam) ? nextParam : "/");
    }
  }, [user, isLoading, isPublicPath, pathname, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Avoid flashing protected content while the redirect is in flight.
  if (!user && !isPublicPath) {
    return null;
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
