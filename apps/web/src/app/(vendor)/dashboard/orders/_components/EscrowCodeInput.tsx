// app/(vendor)/orders/_components/EscrowCodeInput.tsx
"use client";

import { useState, useRef } from "react";
import { Shield,User } from "lucide-react";

export function EscrowCodeInput() {
  const [code, setCode] = useState(["", "", "", ""]);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, value: string) => {
    if (value.length > 1) return;
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    // Auto-focus next input
    if (value && index < 3) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };
//remember to add proper imagge fetching for the user icon
  return (
    <div>
      <p className="text-sm text-[#5B403C] mb-4">COURIER ASSIGNED</p>
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-full bg-[#F0EDED] flex items-center justify-center">
          <User className="size-8 text-[#5B403C]/40" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm">Gokada Express</p>
          <p className="text-[10px] font-bold text-[#176A22]">5 MINS AWAY</p>
        </div>
        <button className="p-2 text-[#B61913] hover:bg-[#B61913]/5 rounded-full">
          <span className="text-sm">📞</span>
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-[#B61913]" />
          <h4 className="text-sm font-medium uppercase tracking-widest text-[#5B403C]">
            Escrow Release Code
          </h4>
        </div>
        <div className="flex justify-between gap-2">
          {code.map((digit, index) => (
            <input
              key={index}
              ref={(el) => {
                inputs.current[index] = el;
              }}
              type="text"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              className="h-16 w-14 rounded-xl border-2 border-[#E4BEB8] text-center font-sora text-3xl font-bold bg-white focus:border-[#B61913] focus:outline-none transition-all"
              placeholder="-"
            />
          ))}
        </div>
        <p className="text-xs text-center text-[#5B403C]">
          Enter the 4-digit code provided by the driver to release funds.
        </p>
      </div>
    </div>
  );
}
