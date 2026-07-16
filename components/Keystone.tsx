// generated from legacy-icons v0.1.0 — do not edit by hand
// source: https://github.com/legacyai-labs/legacy-icons (src/Keystone.tsx + src/KeystoneGlyph.tsx)
// regenerate: npm run gen:vendor (in the legacy-icons repo), then copy vendor/Keystone.tsx

// Inline keystone mark. Colours come from CSS vars on .canvas-root,
// so it flips automatically between dark/light themes.
export function Keystone({ size, ring = false }: { size: number | string; ring?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="keystone"
      width={size}
      height={size}
      viewBox="0 0 200 200"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      {ring && <circle className="disc" cx="100" cy="100" r="96" />}
      {ring && <circle className="ring" cx="100" cy="100" r="96" />}
      <polygon className="fl" points="62,58 100,58 100,150 84,150" />
      <polygon className="fr" points="100,58 138,58 116,150 100,150" />
      <polygon className="fh" points="98,58 102,58 100,150" />
    </svg>
  );
}

// The keystone mark as a FREESTANDING currentColor glyph — behaves like a
// lucide icon: it inherits the surrounding text colour and auto-inverts with
// the theme. No tile, no .canvas-root, no CSS vars, no classes required.
//
// Facets: left solid currentColor, right currentColor at .55 opacity.
// The right facet starts at x=102 (classic mark: x=100) so a natural 2px gap
// replaces the classic mark's background-coloured hairline notch.
export function KeystoneGlyph({
  size,
  ring = false,
  className,
}: {
  size: number | string;
  ring?: boolean;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      {ring && (
        <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      )}
      <polygon fill="currentColor" points="62,58 100,58 100,150 84,150" />
      <polygon fill="currentColor" opacity="0.55" points="102,58 138,58 116,150 102,150" />
    </svg>
  );
}
