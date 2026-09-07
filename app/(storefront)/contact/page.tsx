"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DemoBanner } from "@/components/storefront/demo-banner";

export default function ContactPage() {
  const [sent, setSent] = useState(false);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-teal-950">Contact</h1>
      <p className="mt-3 text-lg text-teal-800">
        Questions about a delivery, a scent, or a missing jug? Leave a note. This form is
        part of the storefront mockup and does not send email yet.
      </p>
      <DemoBanner className="mt-6">
        Demo contact form — messages stay on this page and are not emailed or stored on
        the server.
      </DemoBanner>
      <Card className="mt-6 space-y-4">
        {sent ? (
          <p className="text-sm text-teal-800">
            Thanks — in the live site this would reach the Detergents Delivered team. For
            now, nothing was transmitted.
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setSent(true);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="contact-name">Name</Label>
              <Input id="contact-name" name="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">Email</Label>
              <Input id="contact-email" name="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-message">How can we help?</Label>
              <Textarea id="contact-message" name="message" required />
            </div>
            <Button type="submit">Send message (demo)</Button>
          </form>
        )}
      </Card>
      <p className="mt-6 text-sm text-teal-800">
        Detergents Delivered · household delivery · hello@detergentsdelivered.example
      </p>
    </div>
  );
}
