import { Card } from "@/components/ui/card";

export default function ShopPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-semibold text-teal-950">Shop</h1>
      <p className="mt-2 max-w-2xl text-teal-800">
        The product catalog is coming in Phase 2. This page is a placeholder so
        the storefront navigation is in place.
      </p>
      <Card className="mt-8">
        <p className="text-sm font-medium text-teal-900">Coming in Phase 2</p>
        <p className="mt-2 text-sm text-teal-800">
          Brands, scents, sizes, and category browsing will land with product
          CRUD and storefront listings.
        </p>
      </Card>
    </div>
  );
}
