// app/login/page.tsx
import type { Metadata } from "next";
import ImagePane from "../_components/ImagePane";
import { MobileLoginLayout } from "./components/MobileLoginLayout";
import { DesktopLoginLayout } from "./components/DesktopLoginLayout";

export const metadata: Metadata = {
  title: "Sign in to your account",
  description:
    "Log in to KiaKia to continue enjoying high-velocity food delivery with zero compromises on quality.",
  openGraph: {
    title: "Sign in | KiaKia",
    description:
      "Log in to KiaKia to continue enjoying high-velocity food delivery.",
    images: ["/assets/login-image.png"],
  },
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col bg-[#FCF9F8] lg:flex-row">
      {/* Desktop Image Pane (hidden on mobile) */}
      <ImagePane
        imageSrc="/assets/login-image.png"
        altText="A KiaKia customer enjoying a freshly delivered meal"
        heading="Welcome Back."
        subheading="Log in to continue enjoying high-velocity food delivery with zero compromises on quality."
      />

      <div className="flex flex-1 flex-col bg-[#FCF9F8] lg:w-1/2 lg:items-center lg:justify-center lg:bg-transparent">
        <MobileLoginLayout />
        <DesktopLoginLayout />
      </div>
    </main>
  );
}
