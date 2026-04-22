/**
 * EAN-13 (GTIN-13) generator and validator.
 *
 * Structure: [12 data digits][check digit] = 13 digits.
 * Check digit follows the GS1 mod-10 algorithm:
 *   sum = sum(d[i] * (i % 2 === 0 ? 1 : 3)) for i in 0..11
 *   check = (10 - sum % 10) % 10
 *
 * Prefix policy: GS1 reserves the range 20–29 ("restricted distribution,
 * MO-defined") for internal / in-store company use that does not require
 * a licensed GS1 Company Prefix. We use "2" as the first digit so every
 * generated code sits inside that range — a valid GS1 prefix without
 * colliding with any real manufacturer's assigned range (e.g. 789/790 Brazil).
 *
 * Validation is equivalent to ronanguilloux/IsoCodes (Gtin/Ean13):
 * the full 13-digit sum (weights 1,3,1,3,...) is divisible by 10.
 */

export const EAN13_PREFIX = "2"; // GS1 restricted-distribution range (20–29)

function calculateCheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(digits12[i], 10);
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Generates a valid EAN-13 code in the GS1 restricted-distribution range (2xx).
 * Layout: "2" + 11 random digits + GS1 mod-10 check digit.
 */
export function generateEAN13(): string {
  let body = EAN13_PREFIX;
  for (let i = 1; i < 12; i++) {
    body += Math.floor(Math.random() * 10).toString();
  }
  const checkDigit = calculateCheckDigit(body);
  return body + String(checkDigit);
}

/**
 * Validates an EAN-13 code (length, digits-only, and check digit).
 */
export function isValidEAN13(ean: string): boolean {
  if (!/^\d{13}$/.test(ean)) return false;
  const expected = calculateCheckDigit(ean.slice(0, 12));
  return parseInt(ean[12], 10) === expected;
}
