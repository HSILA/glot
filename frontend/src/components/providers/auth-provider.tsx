"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { parseApiError } from "@/lib/api-error";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const publicPaths = ["/login", "/register"];
  const isPublicPath = publicPaths.includes(pathname);

  const refreshUser = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/v1/auth/me", {
        credentials: "include",
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      } else {
        // 401 or other error - not logged in
        // IMPORTANT: Must explicitly clear cookies via logout endpoint
        // otherwise middleware sees the cookie and redirects back to protected route, causing loop
        if (response.status === 401) {
          await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
        }
        setUser(null);
      }
    } catch {
      // Network error - treat as not logged in
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
    router.push("/");
  };

  const logout = async () => {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore errors, still clear local state
    }
    setUser(null);
    router.push("/login");
  };

  // Check auth status on mount
  // This allows redirecting logged-in users away from /login
  // Note: No DB lookup if not logged in - fails at JWT check
  useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
      await refreshUser();
      setIsLoading(false);
    };

    checkAuth();
  }, [refreshUser]);

  // Redirect logic
  useEffect(() => {
    if (isLoading) return;

    if (!user && !isPublicPath) {
      router.push("/login");
    } else if (user && isPublicPath) {
      router.push("/");
    }
  }, [user, isLoading, isPublicPath, router]);

  // Show nothing while checking auth (prevents flash)
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Don't render protected content if not authenticated
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
