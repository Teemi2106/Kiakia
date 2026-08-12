// app/register/page.tsx
import { Metadata } from "next";
import ImagePane from "../_components/ImagePane";
import { MobileLayout } from "./components/MobileLayout";
import { DesktopLayout } from "./components/DesktopLayout";

export const metadata: Metadata = {
  title: "Create an account",
  description:
    "Join KiaKia to experience high-velocity food delivery with zero compromises on quality.",
  // Optional: Add more metadata for better SEO
  openGraph: {
    title: "Create an account | KiaKia",
    description:
      "Join KiaKia to experience high-velocity food delivery with zero compromises on quality.",
    images: ["/assets/signup-image.png"],
  },
};

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen flex-col bg-[#FCF9F8] lg:flex-row">
      <ImagePane
        imageSrc="/assets/signup-image.png"
        altText="A KiaKia vendor preparing a fresh meal in their kitchen"
        heading="Join KiaKia Today."
        subheading="Create an account to experience high-velocity food delivery with zero compromises on quality."
      />

      <div className="flex flex-1 flex-col bg-[#FCF9F8] lg:w-1/2 lg:items-center lg:justify-center lg:bg-transparent">
        <MobileLayout />
        <DesktopLayout />
      </div>
    </main>
  );
}
