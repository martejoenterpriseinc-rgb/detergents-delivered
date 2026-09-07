import { Card } from "@/components/ui/card";

const FAQS = [
  {
    q: "What do you deliver?",
    a: "Household staples: liquid and powder detergent, pods, fabric softener, dryer sheets, dish soap, dishwasher pods, all-purpose cleaner, and paper towels. We focus on the heavy, repeat items you hate carrying out of a store.",
  },
  {
    q: "Where do you deliver?",
    a: "A defined metro area around Des Moines for this mockup. Check your ZIP on the delivery area page. Live capacity and route days come later.",
  },
  {
    q: "Do I need a membership?",
    a: "No. Order once or, when subscriptions ship, set a cadence. There is no warehouse-club card and no annual fee.",
  },
  {
    q: "Can I subscribe?",
    a: "The account page shows the subscription shell. Recurring billing, skip, and swap land in a later phase. You can still add subscribe-priced items to a one-time demo cart today.",
  },
  {
    q: "How do payments work right now?",
    a: "They do not. Checkout is a labeled demo: we save a confirmation in your browser and never charge a card or talk to Stripe.",
  },
  {
    q: "What if something is damaged or missing?",
    a: "See the refund policy. In production we will replace or refund the line. In this mockup, contact the team through the contact form — it will not send a live email yet.",
  },
  {
    q: "Do you deliver on a schedule?",
    a: "The operating plan is same-week local drop-off on a chosen day. Driver proof-of-delivery and live SMS are not part of this mockup.",
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-teal-950">FAQ</h1>
      <p className="mt-3 text-lg text-teal-800">
        Straight answers for a household delivery brand — not a warehouse club, not an
        enterprise portal.
      </p>
      <div className="mt-8 space-y-4">
        {FAQS.map((item) => (
          <Card key={item.q} className="space-y-2">
            <h2 className="text-lg font-semibold text-teal-950">{item.q}</h2>
            <p className="text-sm leading-7 text-teal-800">{item.a}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
