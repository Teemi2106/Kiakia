"use client";

import { Button } from "@kiakia/ui";
import { useEffect } from "react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <h2 className="text-lg font-semibold text-ink">Something went wrong loading this page</h2>
      <p className="max-w-sm text-sm text-ink-muted">
        {error.digest ? `Reference: ${error.digest}` : "Please try again."}
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
