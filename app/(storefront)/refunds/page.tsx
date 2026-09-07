import { LegalPage } from "@/components/storefront/legal-page";

export default function RefundsPage() {
  return (
    <LegalPage
      title="Refund policy"
      lede="Household staples should arrive intact and match what you ordered. Here is how we handle misses, damage, and change-of-mind once paid orders are live."
    >
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Damaged or leaking items</h2>
        <p>
          If a jug leaks, a box is crushed, or a scent is not what the listing promised,
          tell us within 7 days of delivery. We will replace the line on a coming route or
          refund that line — we will not make you keep a ruined bottle.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Wrong or missing items</h2>
        <p>
          Check the packing slip against what landed on the porch. A missing SKU is on us.
          We will send it on the next available drop-off or refund the charged amount for
          that line, including its share of tax.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Change of mind</h2>
        <p>
          Unopened, unused products in original packaging can be returned within 14 days
          of delivery for a refund of the merchandise amount. Opened liquids, pods, and
          paper that have been used are not returnable except for a quality issue.
          Delivery fees are refunded only when the whole order is our error.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Subscriptions</h2>
        <p>
          When subscriptions are live you can skip a cycle or cancel before the next
          generate date. Charges already captured follow the same damage and missing-item
          rules. This mockup does not bill subscriptions.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Demo checkout</h2>
        <p>
          Demo orders never collect payment, so there is nothing to refund. The
          confirmation in your browser is a walkthrough, not a charge.
        </p>
      </section>
    </LegalPage>
  );
}
