"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-12">
      <h1 className="text-2xl font-semibold">We could not load your account</h1>
      <p>Your saved information has not been replaced. Please try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
