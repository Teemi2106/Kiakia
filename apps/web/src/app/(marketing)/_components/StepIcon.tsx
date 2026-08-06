// lib/icon-helper.tsx
import { cn } from "@kiakia/ui";
import Image from "next/image";
import type { LucideIcon } from "lucide-react";

export type IconType = LucideIcon | string;

interface IconProps {
  icon: IconType;
  className?: string;
  size?: number;
  alt?: string;
  width?: number;
  height?: number;
}

/**
 * Renders either a PNG image or a Lucide icon component
 * @param icon - Either a string (image path) or a Lucide icon component
 * @param className - Additional CSS classes (applies to Lucide icons only)
 * @param size - Size of the icon in Tailwind units (default: 6 = 24px)
 * @param alt - Alt text for PNG images (default: "Icon")
 * @param width - Custom width in pixels (overrides size)
 * @param height - Custom height in pixels (overrides size)
 */
export function Icon({
  icon,
  className,
  size = 6,
  alt = "Icon",
  width,
  height,
}: IconProps) {
  if (typeof icon === "string") {
    // It's a PNG image path
    const sizeClass = `size-${size}`;
    const pixelSize = size * 4; // Convert Tailwind size to pixels (6 = 24px)
    const finalWidth = width ?? pixelSize;
    const finalHeight = height ?? pixelSize;

    return (
      <Image
        src={icon}
        alt={alt}
        width={finalWidth}
        height={finalHeight}
        className="object-contain"
      />
    );
  }

  // It's a Lucide icon component
  const IconComponent = icon;
  const sizeClass = `size-${size}`;
  return <IconComponent className={cn(sizeClass, className)} />;
}
