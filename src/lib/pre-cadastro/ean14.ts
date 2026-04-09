/**
 * EAN-14 (GTIN-14) Generator for internal use.
 *
 * Structure: [indicator][12-digit number][check digit]
 * - Indicator "2" = restricted distribution / internal use (no GS1 prefix needed)
 * - 12-digit number = sequential, zero-padded
 * - Check digit = GS1 mod-10 algorithm
 *
 * Usage: generateEAN14(sequentialNumber) → "20000000000018"
 */

/**
 * Calculates the GS1 mod-10 check digit for a 13-digit string.
 * The algorithm: multiply digits alternately by 1 and 3 (left to right),
 * sum them, check digit = (10 - (sum % 10)) % 10.
 */
function calculateCheckDigit(digits13: string): number {
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const digit = parseInt(digits13[i], 10);
    // Positions 0, 2, 4... multiply by 1; positions 1, 3, 5... multiply by 3
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Generates a valid EAN-14 code for internal use.
 *
 * @param sequentialNumber - The sequential number (1, 2, 3, ...)
 * @param indicator - Packaging indicator digit (default "2" for internal use)
 * @returns A valid 14-digit EAN-14 string
 */
export function generateEAN14(sequentialNumber: number, indicator = "2"): string {
  // Pad sequential number to 12 digits
  const body = String(sequentialNumber).padStart(12, "0");

  // First 13 digits: indicator + 12-digit body
  const first13 = indicator + body;

  // Calculate and append check digit
  const checkDigit = calculateCheckDigit(first13);
  return first13 + String(checkDigit);
}

/**
 * Validates an EAN-14 code (checks length and check digit).
 */
export function isValidEAN14(ean: string): boolean {
  if (!/^\d{14}$/.test(ean)) return false;
  const first13 = ean.slice(0, 13);
  const expectedCheck = calculateCheckDigit(first13);
  return parseInt(ean[13], 10) === expectedCheck;
}

/**
 * Extracts the next sequential number from a list of existing EAN-14 codes.
 * Looks at codes starting with the given indicator to find the max sequence.
 */
export function getNextSequential(existingEans: string[], indicator = "2"): number {
  let maxSeq = 0;
  for (const ean of existingEans) {
    if (ean.length === 14 && ean[0] === indicator) {
      const seq = parseInt(ean.slice(1, 13), 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  return maxSeq + 1;
}
