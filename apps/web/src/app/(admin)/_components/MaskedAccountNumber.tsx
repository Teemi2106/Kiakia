"use client";

import { useState } from "react";

interface MaskedAccountNumberProps {
  /** Already masked server-side (last four digits only). Always safe to render. */
  readonly masked: string;
  /**
   * The full number. Pass it only to admins who may make transfers
   * (canManageFinance()); anything passed here is part of the client payload.
   */
  readonly fullNumber?: string;
}

/** Shows the masked number; offers Show/Hide only when the server supplied the full one. */
export function MaskedAccountNumber({ masked, fullNumber }: MaskedAccountNumberProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono">{revealed && fullNumber ? fullNumber : masked}</span>
      {fullNumber && (
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          className="text-xs text-brand-600 hover:underline"
        >
          {revealed ? "Hide" : "Show"}
        </button>
      )}
    </span>
  );
}
