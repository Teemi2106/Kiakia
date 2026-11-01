// app/(customer)/tracking/_components/Timeline.tsx
"use client";

import { Check, ChevronRight, CheckCircle2, MapPin } from "lucide-react";
import Link from "next/link";

interface TimelineStep {
  id: string;
  label: string;
  time: string;
  status: "done" | "active" | "pending";
}

interface TimelineProps {
  steps: TimelineStep[];
  orderId?: string; // Add orderId for linking
}

export function Timeline({ steps, orderId }: TimelineProps) {
  // Check if all steps are done (delivered)
  const allDone = steps.every((step) => step.status === "done");

  return (
    <div className="relative space-y-6 pl-6">
      {/* Vertical Line */}
      <div className="absolute left-2.5 top-2 h-full w-0.5 bg-kk-hair-soft" />

      {steps.map((step, index) => {
        const isDone = step.status === "done";
        const isActive = step.status === "active";
        const isPending = step.status === "pending";

        return (
          <div key={step.id} className="relative">
            {/* Status Circle */}
            <div
              className={`absolute -left-[22px] top-0 flex h-6 w-6 items-center justify-center rounded-full border-4 border-kk-cream ${
                isDone || isActive ? "bg-kk-red" : "bg-kk-hair-soft"
              } ${isActive ? "shadow-[0_0_0_4px_rgba(182,25,19,0.1)]" : ""}`}
            >
              {isDone && <Check className="size-3 text-white" />}
              {isActive && <ChevronRight className="size-3 text-white" />}
            </div>

            {/* Content */}
            <div className="pl-1">
              <p
                className={`font-inter text-sm font-semibold ${
                  isActive ? "text-kk-red-ink" : "text-kk-ink"
                }`}
              >
                {step.label}
              </p>
              <p className="font-inter text-xs font-medium text-kk-cocoa">
                {step.time}
              </p>
            </div>
          </div>
        );
      })}

      {/* View Delivery Status Button - Always visible when orderId is provided */}
      {orderId && (
        <div className="mt-4 pt-2">
          <Link
            href={`/orders/${orderId}/delivered`}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 font-inter text-sm font-semibold shadow-sm transition-colors ${
              allDone
                ? "bg-kk-red text-white hover:bg-kk-red-hover"
                : "border-2 border-kk-orange-ink bg-transparent text-kk-orange-ink hover:bg-kk-sand"
            }`}
          >
            {allDone ? (
              <>
                <CheckCircle2 className="size-4" />
                View Delivery Status
              </>
            ) : (
              <>
                <MapPin className="size-4" />
                Track Delivery
              </>
            )}
          </Link>
        </div>
      )}
    </div>
  );
}
