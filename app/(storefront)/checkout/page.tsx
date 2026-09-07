import { CheckoutForm } from "@/components/storefront/checkout-form";

export default function CheckoutPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold text-teal-950">Checkout</h1>
      <p className="mt-2 max-w-2xl text-teal-800">
        Confirm a delivery address in a demo ZIP, review the summary, and place a local
        confirmation. Cards are not charged.
      </p>
      <div className="mt-8">
        <CheckoutForm />
      </div>
    </div>
  );
}
