import * as React from "react";
import { cn } from "../../lib/utils";

export interface TooltipProps {
  children: React.ReactElement;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  disabled?: boolean;
}

const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
  (
    {
      children,
      content,
      side = "top",
      align = "center",
      delayDuration = 200,
      disabled = false,
    },
    ref
  ) => {
    const [isVisible, setIsVisible] = React.useState(false);
    const [isMounted, setIsMounted] = React.useState(false);
    const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleMouseEnter = () => {
      if (disabled) return;
      timeoutRef.current = setTimeout(() => {
        setIsVisible(true);
        setIsMounted(true);
      }, delayDuration);
    };

    const handleMouseLeave = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setIsVisible(false);
      setTimeout(() => setIsMounted(false), 150);
    };

    const handleFocus = () => {
      if (disabled) return;
      setIsMounted(true);
      setIsVisible(true);
    };

    const handleBlur = () => {
      setIsVisible(false);
      setTimeout(() => setIsMounted(false), 150);
    };

    React.useEffect(() => {
      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    }, []);

    const sideClasses = {
      top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
      right: "left-full top-1/2 -translate-y-1/2 ml-2",
      bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
      left: "right-full top-1/2 -translate-y-1/2 mr-2",
    };

    const alignClasses = {
      start: "",
      center: "",
      end: "",
    };

    return (
      <div ref={ref} className="relative inline-block">
        {React.cloneElement(
          children as React.ReactElement<React.HTMLAttributes<HTMLElement>>,
          {
            onMouseEnter: handleMouseEnter,
            onMouseLeave: handleMouseLeave,
            onFocus: handleFocus,
            onBlur: handleBlur,
          }
        )}
        {isMounted && (
          <div
            className={cn(
              "absolute z-50 px-2.5 py-1.5 text-xs font-medium text-white bg-kai-text rounded-lg shadow-lg whitespace-nowrap pointer-events-none",
              "transition-all duration-150 ease-out",
              sideClasses[side],
              alignClasses[align],
              isVisible
                ? "opacity-100 scale-100"
                : "opacity-0 scale-95"
            )}
            role="tooltip"
          >
            {content}
            {/* Arrow */}
            <span
              className={cn(
                "absolute w-2 h-2 bg-kai-text rotate-45",
                side === "top" && "top-full left-1/2 -translate-x-1/2 -mt-1",
                side === "right" && "right-full top-1/2 -translate-y-1/2 -mr-1",
                side === "bottom" && "bottom-full left-1/2 -translate-x-1/2 -mb-1",
                side === "left" && "left-full top-1/2 -translate-y-1/2 -ml-1"
              )}
            />
          </div>
        )}
      </div>
    );
  }
);
Tooltip.displayName = "Tooltip";

export { Tooltip };
