import * as React from "react";
import { cn } from "@/lib/utils";

type PillVariant = "default" | "accent" | "outline" | "warn" | "good" | "bad" | "info";

interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: PillVariant;
}

export function Pill({ variant = "default", className, ...props }: PillProps) {
  const variantClass = variant === "default" ? "" : variant;
  return <span className={cn("pill", variantClass, className)} {...props} />;
}
