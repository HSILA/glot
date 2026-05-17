import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Glot — Remember anything, in minutes a day",
  description:
    "A personal learning companion that adapts to how your memory works — for languages, facts, and anything worth knowing.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Glot",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

const tweaksScript = `(function(){try{var s=localStorage.getItem('glot:tweaks');var t='dark',a='lime',d='regular';if(s){var p=JSON.parse(s);t=p.theme||t;a=p.accent||a;d=p.density||d;}var r=document.documentElement;r.setAttribute('data-theme',t);r.setAttribute('data-accent',a);r.setAttribute('data-density',d);}catch(e){document.documentElement.setAttribute('data-theme','dark');document.documentElement.setAttribute('data-accent','lime');document.documentElement.setAttribute('data-density','regular');}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="dark" data-accent="lime" data-density="regular">
      <head>
        <script dangerouslySetInnerHTML={{ __html: tweaksScript }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
