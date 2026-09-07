import { PhasePlaceholder } from "@/components/admin/phase-placeholder";

export default function Page() {
  return (
    <PhasePlaceholder
      title="Orders"
      phase={3}
      summary="Checkout, capture, fulfillment, and order history are not implemented yet."
    />
  );
}
