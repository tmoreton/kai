import * as React from "react";
import { cn } from "../../lib/utils";
import { Button, type ButtonProps } from "./button";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: ButtonProps["variant"];
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    { className, icon, title, description, action, secondaryAction, ...props },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col items-center justify-center text-center p-8",
          className
        )}
        {...props}
      >
        {icon && (
          <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-4 text-muted-foreground">
            {icon}
          </div>
        )}
        <h3 className="text-lg font-semibold text-kai-text mb-1">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            {description}
          </p>
        )}
        {(action || secondaryAction) && (
          <div className="flex items-center gap-3 mt-2">
            {action && (
              <Button
                onClick={action.onClick}
                variant={action.variant || "default"}
              >
                {action.label}
              </Button>
            )}
            {secondaryAction && (
              <Button onClick={secondaryAction.onClick} variant="ghost">
                {secondaryAction.label}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
