/**
 * How one GST rate becomes the right pair of numbers on an invoice (Spec §5.8).
 *
 * The rate never changes — 18% is 18% — but the charge is apportioned by where the
 * supply lands. Within the supplier's own state it splits equally into CGST (to the
 * centre) and SGST (to that state). Across states it is a single IGST charge. The
 * customer's input-tax-credit claim is made against whichever of those the invoice
 * declares, so getting the pair wrong makes the document unusable for them even
 * though the amount they pay is identical.
 */

export type TaxKind = 'INTRA_STATE' | 'INTER_STATE';

export interface GstSplit {
  kind: TaxKind;
  cgst: number;
  sgst: number;
  igst: number;
  /** The state code the split was decided against, for storing on the invoice. */
  placeOfSupplyStateCode: string | null;
}

const money = (n: number) => Math.round(n * 100) / 100;

/** Two digits, as they appear at the front of a GSTIN. Anything else is not a code. */
export function normaliseStateCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = String(value).trim();
  return /^[0-9]{2}$/.test(digits) ? digits : null;
}

/** The first two characters of a GSTIN are the registered state. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const s = String(gstin).trim().toUpperCase();
  return s.length === 15 ? normaliseStateCode(s.slice(0, 2)) : null;
}

/**
 * @param gstAmount   total tax already computed from the lines
 * @param supplierStateCode  our own registered state (from company settings)
 * @param placeOfSupply      the recipient's state, when known
 *
 * When the place of supply is unknown we treat the supply as intra-state. That is
 * not a shrug: for a recipient who is unregistered and has no address on record,
 * the place of supply is the supplier's own location, which makes CGST+SGST the
 * correct pair. Where a customer IS registered, their GSTIN carries their state and
 * this never has to guess.
 */
export function splitGst(
  gstAmount: number,
  supplierStateCode: string | null | undefined,
  placeOfSupply: string | null | undefined,
): GstSplit {
  const supplier = normaliseStateCode(supplierStateCode);
  const recipient = normaliseStateCode(placeOfSupply);
  const total = money(gstAmount);

  const interState = supplier !== null && recipient !== null && supplier !== recipient;

  if (interState) {
    return { kind: 'INTER_STATE', cgst: 0, sgst: 0, igst: total, placeOfSupplyStateCode: recipient };
  }

  // Halve to the paise, then derive the other half by subtraction so the two always
  // add back to exactly the total — an odd number of paise must not vanish or double.
  const cgst = money(total / 2);
  return {
    kind: 'INTRA_STATE',
    cgst,
    sgst: money(total - cgst),
    igst: 0,
    placeOfSupplyStateCode: recipient ?? supplier,
  };
}

/** Indian state/UT codes as used by GST, for showing a name next to the number. */
export const GST_STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

export function stateLabel(code: string | null | undefined): string | null {
  const c = normaliseStateCode(code);
  if (!c) return null;
  const name = GST_STATE_NAMES[c];
  return name ? `${name} (${c})` : c;
}
