import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { RegisterForm } from "../_components/RegisterForm";

export const metadata: Metadata = { title: "Create an account" };

export default function RegisterPage() {
  return (
    <main className="flex flex-1 flex-col lg:flex-row">
      <div className="relative hidden shrink-0 lg:block lg:w-1/2">
        <Image
          src="/assets/signu-image.png"
          alt="A KiaKia vendor preparing a fresh meal in their kitchen"
          fill
          sizes="50vw"
          quality={90}
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-10">
          <h1 className="text-4xl leading-tight font-bold text-white">
            Fast. Fresh. Reliable.
          </h1>
          <p className="mt-3 max-w-sm text-sm text-white/85">
            Join the KiaKia marketplace to experience high-velocity food
            delivery with zero compromises on quality.
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-surface-sunken px-4 py-12 lg:w-1/2">
        <div className="w-full max-w-sm shadow-lg p-4">
          <h1 className="text-xl font-semibold text-ink">Create an Account</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Enter your details to get started with KiaKia.
          </p>
          <div className="mt-6">
            <RegisterForm />
          </div>
          <p className="mt-4 text-center text-sm text-ink-muted">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-brand-600 hover:underline"
            >
              Log in
            </Link>
          </p>
          <p className="mt-4 text-center text-xs text-ink-muted">
            By creating an account, you agree to our{" "}
            <span className="underline">Terms of Service</span> and{" "}
            <span className="underline">Privacy Policy</span>
          </p>
        </div>
      </div>
    </main>
  );
}
