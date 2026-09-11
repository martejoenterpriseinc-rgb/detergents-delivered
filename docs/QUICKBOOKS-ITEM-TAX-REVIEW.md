# Product receipt tax treatment

The existing company product-link editor now requires a deliberate taxable or non-taxable selection before saving a product link. This is a reviewed item classification for receipt export, not a tax rate or a recalculation of historical orders. Zero tax on an order never automatically selects non-taxable.

The selected TAX/NON value is included in the versioned mapping and its permanent audit. Changing the product/provider selection resets the editor's tax choice and confirmation. Failed saves keep the choice and request key. Household customer links cannot carry an item tax classification.

Existing mappings remain readable and are explicitly shown as not reviewed. Older clients that omit tax treatment preserve an existing classification only when the remote item is unchanged; changing the remote item without an explicit reviewed classification clears it to unknown. Historical audit entries remain intact. Receipt compilation requires an explicit classification and refuses to change a positively taxed original sale line to non-taxable.

A posted receipt must retain its original mapping, including tax treatment, for its later refunds. Current mapping edits cannot rewrite historical provider entries. Native tests cover replay, conflicting retry choices, legacy saves and remapping; browser acceptance covers deliberate selection on desktop, tablet and mobile. Real provider tax and agency acceptance is still required separately.
