"use client";

/**
 * The Keystone logo square is a silent theme toggle (nexus-style): clicking
 * it flips the whole app between the dark default and its exact negative.
 * Deliberately NO added affordance — the logo looks and behaves like before;
 * the mark itself flips (white square / black keystone) via .canvas-root.
 *
 * State: data-theme="light" on <html> + localStorage("legacy-theme").
 * An inline script in app/layout.tsx re-applies it before first paint.
 */
export function ThemeToggle({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      className={className}
      style={style}
      onClick={(e) => {
        // Some lockups sit inside a home <Link> — the square itself must
        // only toggle, never navigate.
        e.preventDefault();
        e.stopPropagation();
        const root = document.documentElement;
        const light = root.dataset.theme !== "light";
        if (light) root.dataset.theme = "light";
        else delete root.dataset.theme;
        try {
          localStorage.setItem("legacy-theme", light ? "light" : "dark");
        } catch {
          /* storage unavailable — the flip still applies to this page */
        }
      }}
    >
      {children}
    </span>
  );
}
