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
      <h3 className="font-sora text-2xl font-semibold text-[#1C1B1B]">
        Frequently Asked Questions
      </h3>

      <div className="mt-4 space-y-3">
        {FAQS.map((faq, index) => {
          const isOpen = openIndex === index;
          return (
            <button
              key={index}
              onClick={() => toggleFAQ(index)}
              className="w-full rounded-xl border border-[#E5E2E1] bg-[#FCF9F8] p-4 text-left transition-colors hover:bg-[#F6F3F2]"
            >
              <div className="flex items-center justify-between">
                <span className="font-inter text-sm font-semibold text-[#1C1B1B]">
                  {faq.question}
                </span>
                {isOpen ? (
                  <ChevronUp className="size-4 text-[#1C1B1B]" />
                ) : (
                  <ChevronDown className="size-4 text-[#1C1B1B]" />
                )}
              </div>
              {isOpen && (
                <p className="mt-3 font-inter text-sm text-[#5B403C]">
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
