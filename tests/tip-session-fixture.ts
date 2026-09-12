import type Stripe from "stripe";
export function tipSession(
  id: string,
  amount = 315,
  paid = false,
): Stripe.Checkout.Session {
  const tax = paid ? 25 : 0;
  return {
    id: `cs_${id}`,
    client_reference_id: id,
    metadata: { tipId: id, project: "detergents-delivered" },
    mode: "payment",
    livemode: false,
    currency: "usd",
    customer: `cus_${id}`,
    status: paid ? "complete" : "open",
    payment_status: paid ? "paid" : "unpaid",
    automatic_tax: { enabled: true, status: "complete" },
    amount_subtotal: amount,
    amount_total: amount + tax,
    total_details: { amount_tax: tax, amount_shipping: 0, amount_discount: 0 },
    url: `https://checkout.stripe.com/c/pay/${id}`,
    line_items: {
      has_more: false,
      data: [
        {
          quantity: 1,
          currency: "usd",
          amount_subtotal: amount,
          amount_total: amount + tax,
          amount_tax: tax,
          amount_discount: 0,
          price: {
            currency: "usd",
            unit_amount: amount,
            tax_behavior: "exclusive",
            product: {
              id: `prod_${id}`,
              metadata: { tipId: id },
              tax_code: "txcd_00000000",
            },
          },
        },
      ],
    },
    payment_intent: paid
      ? {
          id: `pi_${id}`,
          status: "succeeded",
          amount: amount + tax,
          amount_received: amount + tax,
          customer: `cus_${id}`,
          currency: "usd",
          livemode: false,
          metadata: { tipId: id, project: "detergents-delivered" },
        }
      : null,
  } as unknown as Stripe.Checkout.Session;
}
