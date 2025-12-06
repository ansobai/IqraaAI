// utils/toArabicNumber.ts

const arabicDigits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

export function toArabicNumber(input: number | string): string {
  return String(input)
    .split("")
    .map((char) => (/\d/.test(char) ? arabicDigits[Number(char)] : char))
    .join("");
}
