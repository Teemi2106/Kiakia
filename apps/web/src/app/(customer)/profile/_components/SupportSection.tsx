// app/(customer)/profile/_components/SupportSection.tsx
"use client";

import { Mail, MessageCircle } from "lucide-react";
import {
  SUPPORT_EMAIL,
  SUPPORT_EMAIL_HREF,
  SUPPORT_WHATSAPP_URL,
} from "@/lib/support-contacts";

export function SupportSection() {
  return (
    <div>
      <h2 className="font-sora text-[32px] font-bold leading-10 tracking-[-0.32px] text-kk-ink">
        How can we help?
      </h2>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row">
        {/* Live Chat Card */}
        <a
          href={SUPPORT_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-start gap-4 rounded-xl border border-kk-hair p-4 transition-colors hover:bg-kk-cream"
        >
          <div className="rounded-full bg-notice-surface p-3">
            <MessageCircle className="size-5 text-notice-ink" />
          </div>
          <div className="flex-1 text-left">
            <h3 className="font-inter text-sm font-bold text-kk-ink">
              Live Chat
            </h3>
            <p className="font-inter text-xs font-medium text-kk-cocoa">
              Chat with our support team in real-time
            </p>
          </div>
        </a>

        {/* Email Support Card */}
        <a
          href={SUPPORT_EMAIL_HREF}
          className="flex flex-1 items-start gap-4 rounded-xl border border-kk-hair p-4 transition-colors hover:bg-kk-cream"
        >
          <div className="rounded-full bg-kk-green-wash p-3">
            <Mail className="size-5 text-kk-green-ink" />
          </div>
          <div className="flex-1 text-left">
            <h3 className="font-inter text-sm font-bold text-kk-ink">
              Email Support
            </h3>
            <p className="font-inter text-xs font-medium text-kk-cocoa">
              {SUPPORT_EMAIL}
            </p>
          </div>
        </a>
      </div>
    </div>
  );
}
