import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Glot - Sign In",
  description: "Sign in to your Glot account",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth pages don't use the AppShell (sidebar/header)
  return <>{children}</>;
}
