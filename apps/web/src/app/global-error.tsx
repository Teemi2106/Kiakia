"use client";

/**
 * Catches errors thrown by the root layout itself — the one place
 * error.tsx can't help, since error.tsx boundaries sit inside the layout
 * they protect. Must render its own <html>/<body>; it replaces the whole
 * document when it fires. Kept deliberately free of any import that could
 * itself fail (no design tokens, no fonts) since this is the last line of
 * defense.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: "#666", marginTop: "0.5rem" }}>
            {error.digest ? `Reference: ${error.digest}` : "Please try again."}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1.25rem",
              borderRadius: "0.5rem",
              background: "#c1401f",
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
