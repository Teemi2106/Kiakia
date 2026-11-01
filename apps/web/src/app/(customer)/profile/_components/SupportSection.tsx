// app/(customer)/profile/_components/SupportSection.tsx
"use client";

import { MessageCircle, Mail, ArrowRight } from "lucide-react";

export function SupportSection() {
  return (
    <div>
      <h2 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-kk-ink">
        How can we help?
      </h2>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row">
        {/* Live Chat Card */}
        <button className="flex flex-1 items-start gap-4 rounded-xl border border-kk-hair p-4 transition-colors hover:bg-kk-cream">
          <div className="rounded-full bg-notice-surface p-3">
            <MessageCircle className="size-5 text-[#301400]" />
          </div>
          <div className="flex-1 text-left">
            <h3 className="font-inter text-sm font-bold text-kk-ink">
              Live Chat
            </h3>
            <p className="font-inter text-xs font-medium text-kk-cocoa">
              Chat with our support team in real-time
            </p>
          </div>
        </button>

        {/* Email Support Card */}
        <button className="flex flex-1 items-start gap-4 rounded-xl border border-kk-hair p-4 transition-colors hover:bg-kk-cream">
          <div className="rounded-full bg-[#A3F69D] p-3">
            <Mail className="size-5 text-[#002204]" />
          </div>
          <div className="flex-1 text-left">
            <h3 className="font-inter text-sm font-bold text-kk-ink">
              Email Support
            </h3>
            <p className="font-inter text-xs font-medium text-kk-cocoa">
              Send us an email and we&apos;ll get back to you
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
