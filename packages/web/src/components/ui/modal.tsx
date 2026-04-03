import { useEffect } from "react";
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
}

export function Modal({
  isOpen,
  onClose,
  children,
  position = "center",
  backdrop = "dark",
  className,
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex",
        position === "center" && "items-center justify-center",
        position === "top" && "items-start justify-center pt-32",
        backdrop === "light" && "bg-black/30",
        backdrop === "dark" && "bg-black/50",
        backdrop === "blur" && "bg-black/50 backdrop-blur-sm",
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn("w-full", className)}>{children}</div>
    </div>
  );
}
