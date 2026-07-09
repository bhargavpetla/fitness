"use client";

// Chrome icons: Ionicons SVGs (MIT, github.com/ionic-team/ionicons — Apple-
// style outlines) vendored in public/icons, tinted via CSS mask so they take
// currentColor like text does.

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const mask = `url(/icons/${name}.svg) no-repeat center / contain`;
  return (
    <span
      aria-hidden
      className="icon"
      style={{ width: size, height: size, WebkitMask: mask, mask }}
    />
  );
}
