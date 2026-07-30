-- GST apportionment (Spec §5.8).
--
-- One rate, charged two ways: within the supplier's own state the tax splits
-- equally into CGST (centre) and SGST (state); across states it is a single IGST
-- charge. `gstAmount` stays the total and the source of truth for `total`; these
-- columns record how that same amount was apportioned, and are stored rather than
-- derived so reprinting an old invoice never restates history.
--
-- All additive with defaults, so existing rows stay valid: a pre-existing invoice
-- keeps its gstAmount and simply reports 0 in each split, which is honest — we do
-- not know retroactively what its place of supply was.
ALTER TABLE "invoices"
  ADD COLUMN "cgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "sgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "igstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "placeOfSupplyStateCode" VARCHAR(2),
  ADD COLUMN "clientGstin" TEXT;

-- HSN (goods) / SAC (services) per line. Optional: required on B2B invoices above
-- the turnover thresholds, which this system cannot determine for a given business.
ALTER TABLE "invoice_lines"
  ADD COLUMN "hsnSac" VARCHAR(8);

-- Billing identity of the customer. stateCode is the place of supply that decides
-- intra- vs inter-state. Nullable: an org is created as a reservation before anyone
-- knows who the client is, and an unregistered (B2C) customer has no GSTIN at all.
ALTER TABLE "client_orgs"
  ADD COLUMN "gstin" VARCHAR(15),
  ADD COLUMN "stateCode" VARCHAR(2),
  ADD COLUMN "billingAddress" TEXT;
