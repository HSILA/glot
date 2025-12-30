"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, Lock, ArrowRight, KeyRound, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/providers/auth-provider";

export default function LoginPage() {
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col relative overflow-x-hidden">
      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-30">
          <div
            className="absolute top-0 left-[-100px] w-[500px] h-[500px] bg-primary/30 rounded-full mix-blend-screen filter blur-[100px] animate-pulse"
            style={{ animationDuration: "4s" }}
          />
          <div className="absolute bottom-0 right-[-100px] w-[500px] h-[500px] bg-secondary rounded-full mix-blend-screen filter blur-[100px] opacity-70" />
        </div>
      </div>

      {/* Header */}
      <header className="w-full p-6 flex justify-between items-center z-10 relative shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-lg">
            <span className="text-primary-foreground font-bold text-sm">G</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">Glot</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 z-20">
        <div className="w-full max-w-[400px] mx-auto">
          {/* Glass Card */}
          <div className="relative overflow-hidden rounded-2xl md:rounded-3xl bg-card/80 backdrop-blur-xl border border-border shadow-2xl p-6 md:p-10">
            {/* Top Shine */}
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

            {/* Header */}
            <div className="text-center mb-6 md:mb-8 space-y-2 relative z-10">
              <div className="inline-flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-primary/10 border border-primary/20 shadow-lg backdrop-blur-md mb-2 md:mb-4 transition-transform hover:scale-105 duration-500">
                <KeyRound className="text-primary" size={22} />
              </div>
              <h1 className="font-serif text-2xl md:text-3xl text-foreground tracking-wide">
                Welcome back
              </h1>
              <p className="text-muted-foreground text-sm font-light px-4">
                Enter your credentials to continue learning.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5 relative z-10">
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  {error}
                </div>
              )}

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase tracking-wider ml-1">
                  Email
                </Label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <Mail size={18} />
                  </div>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="name@company.com"
                    className="pl-10 h-12 bg-background/50 border-border/50 focus:border-primary/50"
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase tracking-wider ml-1">
                  Password
                </Label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <Lock size={18} />
                  </div>
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    className="pl-10 pr-10 h-12 bg-background/50 border-border/50 focus:border-primary/50"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <div className="flex justify-end">
                  <Link
                    href="#"
                    className="text-xs text-muted-foreground hover:text-foreground transition-all"
                  >
                    Forgot password?
                  </Link>
                </div>
              </div>

              {/* Submit */}
              <div className="pt-2">
                <Button
                  type="submit"
                  className="w-full h-12 text-base font-medium"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <svg
                        className="animate-spin -ml-1 mr-2 h-4 w-4"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign In
                      <ArrowRight size={18} className="ml-1" />
                    </>
                  )}
                </Button>
              </div>
            </form>

            {/* Footer */}
            <div className="mt-6 md:mt-8 pt-6 border-t border-border/50 text-center relative z-10">
              <p className="text-muted-foreground text-sm font-light">
                New here?{" "}
                <Link
                  href="/register"
                  className="font-medium text-foreground hover:text-primary hover:underline transition-colors"
                >
                  Create an account
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full p-6 text-center text-muted-foreground/50 text-sm z-10 relative shrink-0">
        © {new Date().getFullYear()} Glot. All rights reserved.
      </footer>
    </div>
  );
}
