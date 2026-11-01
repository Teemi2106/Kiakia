// app/(customer)/profile/_components/FAQSection.tsx
"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

const FAQS = [
  {
    question: "How do I track my order?",
    answer:
      "You can track your order in real-time from the Orders section. Once your order is confirmed, you'll receive a tracking link via SMS and email.",
  },
  {
    question: "What is the delivery policy?",
    answer:
      "We deliver within 30-45 minutes depending on your location. Delivery fees vary based on distance and are calculated at checkout.",
  },
  {
    question: "How do I change my delivery address?",
    answer:
      "You can change your delivery address in the Saved Addresses section of your profile. You can also change it during checkout.",
  },
] as const;

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="mt-8">
      <h3 className="font-sora text-2xl font-semibold text-kk-ink">
        Frequently Asked Questions
      </h3>

      <div className="mt-4 space-y-3">
        {FAQS.map((faq, index) => {
          const isOpen = openIndex === index;
          return (
            <button
              key={index}
              onClick={() => toggleFAQ(index)}
              className="w-full rounded-xl border border-kk-hair bg-kk-cream p-4 text-left transition-colors hover:bg-kk-sand"
            >
              <div className="flex items-center justify-between">
                <span className="font-inter text-sm font-semibold text-kk-ink">
                  {faq.question}
                </span>
                {isOpen ? (
                  <ChevronUp className="size-4 text-kk-ink" />
                ) : (
                  <ChevronDown className="size-4 text-kk-ink" />
                )}
              </div>
              {isOpen && (
                <p className="mt-3 font-inter text-sm text-kk-cocoa">
                  {faq.answer}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
