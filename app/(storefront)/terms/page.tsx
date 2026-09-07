import { LegalPage } from "@/components/storefront/legal-page";
import { getPublicDeliveryInfo } from "@/lib/services/delivery-settings";

export default async function TermsPage() {
  const delivery = await getPublicDeliveryInfo();

  return (
    <LegalPage
      title="Terms of use"
      lede="These terms explain how the Detergents Delivered website and household delivery service work. This mockup is for review; live checkout is not enabled."
    >
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Who we are</h2>
        <p>
          Detergents Delivered sells household cleaning staples and delivers them locally.
          The website, admin tools, and driver tools are one product. Using the public
          site means you agree to these terms and our privacy and refund policies.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Accounts</h2>
        <p>
          You are responsible for the email and password you use to sign in. Household
          accounts are for personal or family restocking, not for resale without a written
          wholesale agreement.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Orders and delivery</h2>
        <p>
          When payments go live, an order is an offer to buy the listed SKUs at the prices
          shown at checkout. {delivery.serviceAreaSummary} {delivery.weeklySummary}{" "}
          {delivery.noSameDaySummary} We may decline or reschedule a stop when a route is
          full. Until then, “Place order (demo)” creates a browser-only confirmation and
          does not form a paid contract.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Pricing</h2>
        <p>
          Retail and subscription prices are stored as integer cents. Sale prices, if
          shown, replace the retail price while they are in effect. Taxes and delivery
          fees on this mockup are estimates for the demo only.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Acceptable use</h2>
        <p>
          Do not misuse the site, attempt to access admin or driver areas without a role,
          or scrape the catalog for competing storefronts. We may suspend an account that
          harms the service or other households.
        </p>
      </section>
    </LegalPage>
  );
}
