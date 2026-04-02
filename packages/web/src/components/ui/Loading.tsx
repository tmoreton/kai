import * as React from "react";
import { cn } from "../../lib/utils";

export interface LoadingProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
  variant?: "default" | "secondary" | "primary";
  label?: string;
}

const sizeMap = {
  sm: "w-4 h-4 border-2",
  md: "w-6 h-6 border-2",
  lg: "w-8 h-8 border-3",
};

const variantMap = {
  default: "border-kai-text/20 border-t-kai-text",
  secondary: "border-kai-text-muted/30 border-t-kai-text-secondary",
  primary: "border-primary/20 border-t-kai-teal",
};

const Loading = React.forwardRef<HTMLDivElement, LoadingProps>(
  ({ className, size = "md", variant = "default", label, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("inline-flex items-center gap-3", className)}
        role="status"
        aria-label={label || "Loading"}
        {...props}
      >
        <div
          className={cn(
            "rounded-full animate-spin",
            sizeMap[size],
            variantMap[variant]
          )}
        />
        {label && (
          <span className="text-sm text-muted-foreground">{label}</span>
        )}
      </div>
    );
  }
);
Loading.displayName = "Loading";

export { Loading };
