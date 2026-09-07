import { CartView } from "@/components/storefront/cart-view";

export default function CartPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold text-teal-950">Cart</h1>
      <p className="mt-2 max-w-2xl text-teal-800">
        Line items live in this browser so you can click through the mockup. Nothing is
        reserved in inventory yet.
      </p>
      <div className="mt-8">
        <CartView />
      </div>
    </div>
  );
}
