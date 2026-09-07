import { LegalPage } from "@/components/storefront/legal-page";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      lede="We treat household delivery data as operational, not a marketing playground. This page describes what the live product will collect and what this mockup stores locally."
    >
      <section>
        <h2 className="text-lg font-semibold text-teal-950">What we collect</h2>
        <p>
          When you create an account we store your name, email, and a hashed password.
          Future paid orders will store delivery addresses, phone numbers, order lines,
          and payment events from our processor — not full card numbers on our servers.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">This mockup</h2>
        <p>
          The demo cart, demo checkout, and demo order list live in your browser
          (localStorage). We do not receive those addresses on the server. Clearing site
          data removes them.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">How we use information</h2>
        <p>
          We use account and order data to pack, deliver, support, and keep books. We do
          not sell household lists. Drivers see the stop details they need for a route,
          not your full payment history.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Cookies and sign-in</h2>
        <p>
          Sign-in uses a session cookie from Auth.js. We also store cart contents locally
          so you can move between shop, cart, and checkout without an account.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold text-teal-950">Your choices</h2>
        <p>
          You can update account details after sign-in and ask us to delete a household
          account. Email hello@detergentsdelivered.example when the live service is
          running. This mockup does not process deletion requests.
        </p>
      </section>
    </LegalPage>
  );
}
