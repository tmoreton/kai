import { useState, useCallback, useEffect } from "react";
import { X, ZoomIn, Download } from "lucide-react";
import { cn } from "../lib/utils";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  className?: string;
  /** Controlled mode: if provided, component is controlled externally */
  isOpen?: boolean;
  /** Callback when lightbox should close (controlled mode) */
  onClose?: () => void;
}

export function ImageLightbox({ src, alt, className, isOpen: controlledIsOpen, onClose }: ImageLightboxProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [scale, setScale] = useState(1);

  // Determine if we're in controlled or uncontrolled mode
  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;

  const open = () => {
    if (!isControlled) {
      setInternalIsOpen(true);
    }
    setScale(1);
    document.body.style.overflow = "hidden";
  };

  const close = () => {
    if (isControlled) {
      onClose?.();
    } else {
      setInternalIsOpen(false);
    }
    setScale(1);
    document.body.style.overflow = "";
  };

  // Handle body scroll lock when open state changes
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const zoomIn = () => setScale(s => Math.min(s + 0.5, 3));

  const handleDownload = useCallback(() => {
    const link = document.createElement("a");
    link.href = src;
    link.download = alt || "image.png";
    link.click();
  }, [src, alt]);

  // In controlled mode without thumbnail, just render the lightbox
  const showThumbnail = !isControlled;

  return (
    <>
      {/* Thumbnail - only show in uncontrolled mode */}
      {showThumbnail && (
        <img
          src={src}
          alt={alt}
          className={cn(
            "rounded-lg cursor-pointer transition-transform hover:scale-[1.02]",
            "border border-border",
            className
          )}
          onClick={open}
        />
      )}

      {/* Lightbox Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
          onClick={close}
        >
          {/* Toolbar */}
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); zoomIn(); }}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDownload(); }}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <Download className="w-5 h-5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); close(); }}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Image */}
          <img
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[90vh] object-contain transition-transform"
            style={{ transform: `scale(${scale})` }}
            onClick={(e) => e.stopPropagation()}
          />

          {/* Zoom indicator */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white/10 text-white text-sm">
            {Math.round(scale * 100)}%
          </div>
        </div>
      )}
    </>
  );
}
