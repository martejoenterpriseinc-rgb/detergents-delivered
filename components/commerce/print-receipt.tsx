"use client";
import { useState } from "react";
export function PrintReceipt() {
  const [error, setError] = useState("");
  return (
    <div className="receipt-actions space-y-2">
      <button
        className="ops-button"
        onClick={() => {
          setError("");
          try {
            window.print();
          } catch {
            setError("Printing is unavailable. Use your browser’s Print menu.");
          }
        }}
      >
        Print or save PDF
      </button>
      <p className="text-sm">
        Choose Save as PDF in your browser’s print window to keep a copy.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
