// app/(marketing)/layout.tsx
//
// Exists only to scope marketing.css to the public pages (/, /terms,
// /privacy, /support). Those keyframes and textures are useless weight on
// the customer and vendor apps, so they're imported here rather than in
// globals.css.
import "./marketing.css";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
