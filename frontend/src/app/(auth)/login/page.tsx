"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div
      className="min-h-[100dvh] flex overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      {/* === Left — brand + manifesto (desktop only) === */}
      <div
        className="hidden lg:flex flex-col justify-between relative overflow-hidden"
        style={{
          flex: 1.1,
          padding: "48px 56px",
          borderRight: "1px solid var(--line)",
          background: "var(--bg-1)",
        }}
      >
        {/* Accent glow */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: -120,
            right: -120,
            width: 360,
            height: 360,
            background: "radial-gradient(circle, var(--accent-glow), transparent 60%)",
          }}
        />

        {/* Logo */}
        <div className="flex items-center gap-3 relative">
          <div
            className="flex items-center justify-center rounded-md font-bold text-lg"
            style={{
              width: 28,
              height: 28,
              background: "var(--accent)",
              color: "var(--accent-fg)",
              fontFamily: "var(--serif)",
            }}
          >
            g
          </div>
          <span
            className="tracking-tight"
            style={{
              fontFamily: "var(--serif)",
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: "-0.03em",
            }}
          >
            Glot<span style={{ color: "var(--accent)" }}>.</span>
          </span>
        </div>

        {/* Manifesto */}
        <div className="relative">
          <h1
            className="mb-6"
            style={{
              fontFamily: "var(--serif)",
              fontSize: 64,
              fontWeight: 500,
              letterSpacing: "-0.035em",
              lineHeight: 0.98,
            }}
          >
            Learn the way{" "}
            <span style={{ fontStyle: "italic", color: "var(--muted)" }}>
              your brain
            </span>{" "}
            wants to.
          </h1>
          <p
            className="leading-relaxed max-w-[480px]"
            style={{ fontSize: 17, color: "var(--muted)" }}
          >
            Spaced repetition, FSRS-tuned. An agent that turns your reading into
            cards. Study sessions that don't feel like chores.
          </p>
          <div
            className="flex gap-6 mt-10 text-sm"
            style={{ color: "var(--muted)" }}
          >
            <div className="flex items-center gap-2">
              <div
                className="rounded-full"
                style={{
                  width: 6,
                  height: 6,
                  background: "var(--accent)",
                }}
              />
              FSRS scheduling
            </div>
            <div className="flex items-center gap-2">
              <div
                className="rounded-full"
                style={{
                  width: 6,
                  height: 6,
                  background: "var(--accent)",
                }}
              />
              Agentic card builder
            </div>
            <div className="flex items-center gap-2">
              <div
                className="rounded-full"
                style={{
                  width: 6,
                  height: 6,
                  background: "var(--accent)",
                }}
              />
              PWA — offline
            </div>
          </div>
        </div>

        {/* Version */}
        <div
          className="relative"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--muted-2)",
            letterSpacing: "0.1em",
          }}
        >
          v0.4.2 · OPEN SOURCE · MIT
        </div>
      </div>

      {/* === Right — form === */}
      <div
        className="flex-1 flex items-center justify-center p-6 sm:p-12"
        style={{ background: "var(--bg)" }}
      >
        <div className="w-full max-w-[380px]">
          {/* Mobile-only logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div
              className="flex items-center justify-center rounded-md font-bold text-lg"
              style={{
                width: 28,
                height: 28,
                background: "var(--accent)",
                color: "var(--accent-fg)",
                fontFamily: "var(--serif)",
              }}
            >
              g
            </div>
            <span
              className="tracking-tight"
              style={{
                fontFamily: "var(--serif)",
                fontSize: 22,
                fontWeight: 500,
                letterSpacing: "-0.03em",
              }}
            >
              Glot<span style={{ color: "var(--accent)" }}>.</span>
            </span>
          </div>

          <h2
            className="mb-2"
            style={{
              fontFamily: "var(--serif)",
              fontSize: 30,
              fontWeight: 500,
              letterSpacing: "-0.02em",
            }}
          >
            Welcome back.
          </h2>
          <p
            className="mb-7"
            style={{ color: "var(--muted)", fontSize: 14 }}
          >
            Sign in to continue your streak.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div
                className="px-4 py-3 rounded-lg text-sm font-medium"
                style={{
                  background: "color-mix(in oklab, var(--bad) 12%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--bad) 30%, transparent)",
                  color: "var(--bad)",
                }}
              >
                {error}
              </div>
            )}

            {/* Email */}
            <div>
              <label
                className="block mb-2"
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--muted)",
                  letterSpacing: "0.12em",
                }}
              >
                EMAIL
              </label>
              <div className="relative">
                <Mail
                  className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  size={16}
                  style={{ color: "var(--muted)" }}
                />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@email.com"
                  className="pl-10 h-11"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                className="block mb-2"
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--muted)",
                  letterSpacing: "0.12em",
                }}
              >
                PASSWORD
              </label>
              <div className="relative">
                <Lock
                  className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  size={16}
                  style={{ color: "var(--muted)" }}
                />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="pl-10 pr-10 h-11"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: "var(--muted)" }}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                className="w-full h-12 text-sm gap-2"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
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
                    Sign in
                    <ArrowRight size={14} />
                  </>
                )}
              </Button>
            </div>

            {/* Footer links */}
            <div
              className="flex justify-between mt-2 text-xs"
              style={{ color: "var(--muted)" }}
            >
              <Link
                href="#"
                className="hover:underline hover:text-[var(--fg)] transition-colors"
              >
                Forgot password?
              </Link>
              <Link
                href="/register"
                className="hover:underline hover:text-[var(--fg)] transition-colors"
              >
                Create account →
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
