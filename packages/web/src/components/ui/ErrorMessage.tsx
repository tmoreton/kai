import * as React from "react";
import { cn } from "../../lib/utils";

export interface ErrorMessageProps extends React.HTMLAttributes<HTMLDivElement> {
  message: string;
  id?: string;
}

const ErrorMessage = React.forwardRef<HTMLDivElement, ErrorMessageProps>(
  ({ className, message, id, ...props }, ref) => {
    return (
      <div
        ref={ref}
        id={id}
        role="alert"
        className={cn(
          "flex items-center gap-1.5 text-sm text-destructive",
          className
        )}
        {...props}
      >
        <svg
          className="w-4 h-4 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <circle cx="12" cy="12" r="10" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
        </svg>
        <span>{message}</span>
      </div>
    );
  }
);
ErrorMessage.displayName = "ErrorMessage";

export { ErrorMessage };
