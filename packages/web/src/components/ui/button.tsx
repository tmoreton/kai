import * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "destructive" | "outline" | "secondary" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const variants = {
      default: "bg-foreground text-background hover:bg-foreground/90",
      ghost: "bg-transparent hover:bg-accent/50",
      destructive: "bg-destructive text-white hover:bg-destructive/90",
      outline: "border border-border bg-transparent hover:bg-accent/50",
      secondary: "bg-card border border-border hover:bg-accent/50",
      link: "bg-transparent text-primary hover:underline",
    };

    const sizes = {
      default: "h-9 px-4 py-2",
      sm: "h-8 px-3 text-sm",
      lg: "h-10 px-6",
      icon: "h-9 w-9",
    };

    return (
      <button
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
          "disabled:opacity-50 disabled:pointer-events-none",
          variants[variant],
          sizes[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button };
