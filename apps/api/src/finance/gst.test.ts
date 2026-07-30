import { describe, expect, it } from 'vitest';
import { normaliseStateCode, splitGst, stateCodeFromGstin, stateLabel } from './gst';

describe('splitGst — same state means CGST + SGST', () => {
  it('halves an even amount', () => {
    expect(splitGst(18000, '33', '33')).toEqual({
      kind: 'INTRA_STATE',
      cgst: 9000,
      sgst: 9000,
      igst: 0,
      placeOfSupplyStateCode: '33',
    });
  });

  it('never loses or invents a paisa on an odd split', () => {
    const s = splitGst(1234.57, '33', '33');
    expect(s.cgst + s.sgst).toBeCloseTo(1234.57, 2);
    expect(s.cgst).toBe(617.29);
    expect(s.sgst).toBe(617.28);
  });

  it('handles zero-rated lines without producing -0 or NaN', () => {
    expect(splitGst(0, '33', '33')).toMatchObject({ cgst: 0, sgst: 0, igst: 0 });
  });
});

describe('splitGst — different states mean a single IGST charge', () => {
  it('puts the whole amount in IGST', () => {
    expect(splitGst(18000, '33', '29')).toEqual({
      kind: 'INTER_STATE',
      cgst: 0,
      sgst: 0,
      igst: 18000,
      placeOfSupplyStateCode: '29',
    });
  });

  it('records the recipient state, not the supplier state', () => {
    expect(splitGst(500, '33', '07').placeOfSupplyStateCode).toBe('07');
  });
});

describe('splitGst — when the recipient state is unknown', () => {
  // Unregistered recipient with no address on record: place of supply is the
  // supplier's own location, so CGST+SGST is the correct pair, not a guess.
  it('falls back to intra-state and records our own state', () => {
    expect(splitGst(1800, '33', null)).toMatchObject({
      kind: 'INTRA_STATE',
      cgst: 900,
      sgst: 900,
      placeOfSupplyStateCode: '33',
    });
  });

  it('still splits when neither state is known', () => {
    const s = splitGst(1800, null, null);
    expect(s.kind).toBe('INTRA_STATE');
    expect(s.cgst + s.sgst).toBe(1800);
    expect(s.placeOfSupplyStateCode).toBeNull();
  });

  it('treats a malformed state code as unknown rather than trusting it', () => {
    expect(splitGst(1000, '33', 'TN').kind).toBe('INTRA_STATE');
    expect(splitGst(1000, '33', '3').kind).toBe('INTRA_STATE');
    expect(splitGst(1000, '33', '333').kind).toBe('INTRA_STATE');
  });
});

describe('state code helpers', () => {
  it('reads the state out of a GSTIN', () => {
    expect(stateCodeFromGstin('33ASGPR8663J1Z6')).toBe('33');
    expect(stateCodeFromGstin('29AABCU9603R1ZM')).toBe('29');
  });

  it('refuses anything that is not a full GSTIN', () => {
    expect(stateCodeFromGstin('33ASGPR')).toBeNull();
    expect(stateCodeFromGstin('')).toBeNull();
    expect(stateCodeFromGstin(null)).toBeNull();
  });

  it('normalises only two-digit codes', () => {
    expect(normaliseStateCode(' 33 ')).toBe('33');
    expect(normaliseStateCode('7')).toBeNull();
    expect(normaliseStateCode('abc')).toBeNull();
    expect(normaliseStateCode(undefined)).toBeNull();
  });

  it('names the state for the invoice', () => {
    expect(stateLabel('33')).toBe('Tamil Nadu (33)');
    expect(stateLabel('29')).toBe('Karnataka (29)');
    expect(stateLabel('99')).toBe('99'); // unknown code still renders, never throws
    expect(stateLabel(null)).toBeNull();
  });
});
