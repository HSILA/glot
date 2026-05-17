import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-lg px-3 text-sm outline-none transition-colors",
        "placeholder:text-[color:var(--muted)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:[box-shadow:0_0_0_2px_var(--accent-glow),0_0_0_1px_var(--accent)]",
        className
      )}
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--line)",
        color: "var(--fg)",
        ...(props.style || {}),
      }}
      {...props}
    />
  );
}

export { Input };
