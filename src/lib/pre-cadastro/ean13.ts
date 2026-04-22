/**
 * EAN-13 (GTIN-13) generator and validator.
 *
 * Structure: [12 data digits][check digit] = 13 digits.
 * Check digit follows the GS1 mod-10 algorithm:
 *   sum = sum(d[i] * (i % 2 === 0 ? 1 : 3)) for i in 0..11
 *   check = (10 - sum % 10) % 10
 *
 * Equivalent to the validation used by ronanguilloux/IsoCodes (Gtin/Ean13),
 * which checks that the full 13-digit sum is divisible by 10.
 */

function calculateCheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(digits12[i], 10);
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Generates a valid EAN-13 code with random data digits.
 * The first digit is forced to be non-zero so the code is always 13 chars
 * when serialized as a number-like string.
 */
export function generateEAN13(): string {
  let body = "";
  // First digit: 1-9 (avoid leading zero)
  body += String(Math.floor(Math.random() * 9) + 1);
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
