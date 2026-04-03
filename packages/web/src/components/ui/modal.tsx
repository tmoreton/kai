import { useEffect, useRef } from "react";
import { cn } from "../../lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Position of modal content */
  position?: "center" | "top";
  /** Background overlay style */
  backdrop?: "light" | "dark" | "blur";
  className?: string;
  /** Modal size for responsive behavior */
  size?: "sm" | "md" | "lg" | "full";
  /** Accessible title for the modal (required for a11y) */
  title?: string;
}

export function Modal({
  isOpen,
  onClose,
  children,
  position = "center",
  backdrop = "dark",
  size = "md",
  title,
  className,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle escape key and focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    // Focus trap - store previously focused element
    const previousActiveElement = document.activeElement as HTMLElement;

    document.addEventListener("keydown", handleEscape);

    // Focus the modal when opened
    if (modalRef.current) {
      modalRef.current.focus();
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      // Restore focus when modal closes
      previousActiveElement?.focus();
    };
  }, [isOpen, onClose]);

  // Handle focus trap
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;

    const modal = modalRef.current;
    if (!modal) return;

    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement?.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement?.focus();
    }
  };

  if (!isOpen) return null;

  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md w-full mx-4",
    lg: "max-w-lg w-full mx-4",
    full: "max-w-full w-full mx-4",
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex",
        position === "center" && "items-center justify-center p-4",
        position === "top" && "items-start justify-center pt-20 sm:pt-32 p-4",
        backdrop === "light" && "bg-black/30",
        backdrop === "dark" && "bg-black/50",
        backdrop === "blur" && "bg-black/50 backdrop-blur-sm"
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "modal-title" : undefined}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className={cn(
          sizeClasses[size],
          "bg-card rounded-xl shadow-xl overflow-hidden outline-none",
          className
        )}
        onKeyDown={handleKeyDown}
      >
        {title && (
          <h2 id="modal-title" className="sr-only">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
