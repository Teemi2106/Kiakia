// components/ImagePane.tsx
import Image from "next/image";

interface ImagePaneProps {
  imageSrc: string;
  altText: string;
  heading: string;
  subheading: string;
}

export default function ImagePane({
  imageSrc,
  altText,
  heading,
  subheading,
}: ImagePaneProps) {
  return (
    <div className="relative hidden lg:block lg:w-1/2">
      <Image
        src={imageSrc}
        alt={altText}
        fill
        sizes="50vw"
        quality={90}
        className="object-cover"
        priority
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-10">
        <h1 className="text-4xl font-bold leading-tight text-white">
          {heading}
        </h1>
        <p className="mt-3 max-w-sm text-sm text-white/85">{subheading}</p>
      </div>
    </div>
  );
}
