import * as React from "react";
import { cn } from "../../lib/utils";

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "checked"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onCheckedChange, disabled, onChange, ...props }, ref) => {
    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      onCheckedChange?.(event.target.checked);
      onChange?.(event);
    };

    return (
      <label
        className={cn(
          "relative inline-flex items-center cursor-pointer",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
      >
        {/* Hidden checkbox for accessibility and form functionality */}
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={handleChange}
          disabled={disabled}
          ref={ref}
          {...props}
        />
        {/* Track */}
        <span
          className={cn(
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out",
            checked
              ? "bg-green-500"
              : "bg-gray-200 dark:bg-gray-700"
          )}
        >
          {/* Thumb */}
          <span
            className={cn(
              "inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ease-in-out shadow-sm",
              checked ? "translate-x-6" : "translate-x-1"
            )}
          />
        </span>
      </label>
    );
  }
);

Switch.displayName = "Switch";

export { Switch };
