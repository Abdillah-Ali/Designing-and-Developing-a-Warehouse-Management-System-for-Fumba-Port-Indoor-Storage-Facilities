import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

function EnterpriseModal({
  open,
  title,
  subtitle,
  children,
  footer,
  onClose,
  size = "large",
  zIndex = 50
}) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const sizes = {
    compact: "max-w-xl sm:w-[92vw] lg:w-[38rem]",
    medium: "max-w-3xl sm:w-[92vw] lg:w-[52rem]",
    large: "max-w-5xl sm:w-[94vw] xl:w-[64vw]",
    review: "max-w-[1280px] sm:w-[94vw] xl:w-[72vw]"
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-[2px] sm:p-6"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section className={cn(
        "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-white/10 bg-card shadow-2xl",
        sizes[size] || sizes.large
      )}>
        <header className="flex items-start justify-between gap-4 border-b border-sidebar-border bg-sidebar px-5 py-4 text-sidebar-foreground">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold sm:text-lg">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-sidebar-foreground/70">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 p-1.5 text-sidebar-foreground/75 transition hover:bg-white/10 hover:text-white"
            aria-label="Close window"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-background p-4 sm:p-5">
          {children}
        </div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-5 py-3">
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
}

export { EnterpriseModal };
