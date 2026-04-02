import * as React from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?:
    | "default"
    | "secondary"
    | "success"
    | "warning"
    | "error"
    | "info"
    | "outline";
  size?: "sm" | "md";
}

const variantMap = {
  default: "bg-kai-text text-white",
  secondary: "bg-kai-bg-hover text-kai-text-secondary",
  success: "bg-kai-green-light text-kai-green",
  warning: "bg-amber-100 text-amber-700",
  error: "bg-kai-red-light text-kai-red",
  info: "bg-kai-teal-light text-kai-teal",
  outline: "border border-kai-border bg-transparent text-kai-text-secondary",
};

const sizeMap = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-0.5 text-sm",
};

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    { className, variant = "default", size = "md", children, ...props },
    ref
  ) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center font-medium rounded-full",
          variantMap[variant],
          sizeMap[size],
          className
        )}
        {...props}
      >
        {children}
      </span>
    );
  }
);
Badge.displayName = "Badge";

export { Badge };
