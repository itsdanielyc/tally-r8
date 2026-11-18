// Money as whole minor units. Nothing here, or anywhere in Tally, turns an
// amount into a floating-point number: text is split into its integer and
// fraction digits and assembled as an integer.

export type Currency = { code: string; name: string; digits: number };

/** ISO 4217 codes with their minor-unit digits. */
const CURRENCIES: readonly Currency[] = [
  { code: "AUD", name: "Australian dollar", digits: 2 },
  { code: "BHD", name: "Bahraini dinar", digits: 3 },
  { code: "BRL", name: "Brazilian real", digits: 2 },
  { code: "CAD", name: "Canadian dollar", digits: 2 },
  { code: "CHF", name: "Swiss franc", digits: 2 },
  { code: "CNY", name: "Chinese yuan", digits: 2 },
  { code: "CZK", name: "Czech koruna", digits: 2 },
  { code: "DKK", name: "Danish krone", digits: 2 },
  { code: "EUR", name: "Euro", digits: 2 },
  { code: "GBP", name: "Pound sterling", digits: 2 },
  { code: "HKD", name: "Hong Kong dollar", digits: 2 },
  { code: "HUF", name: "Hungarian forint", digits: 2 },
  { code: "INR", name: "Indian rupee", digits: 2 },
  { code: "ISK", name: "Icelandic króna", digits: 0 },
  { code: "JPY", name: "Japanese yen", digits: 0 },
  { code: "KRW", name: "South Korean won", digits: 0 },
  { code: "KWD", name: "Kuwaiti dinar", digits: 3 },
  { code: "MXN", name: "Mexican peso", digits: 2 },
  { code: "NOK", name: "Norwegian krone", digits: 2 },
  { code: "NZD", name: "New Zealand dollar", digits: 2 },
  { code: "PLN", name: "Polish złoty", digits: 2 },
  { code: "SEK", name: "Swedish krona", digits: 2 },
  { code: "SGD", name: "Singapore dollar", digits: 2 },
  { code: "USD", name: "US dollar", digits: 2 },
  { code: "ZAR", name: "South African rand", digits: 2 },
];

export const DEFAULT_CURRENCY = "USD";

/** The largest amount Tally accepts, in minor units, either sign. */
export const MAX_AMOUNT = 1_000_000_000_000;

export function findCurrency(code: string): Currency | undefined {
  return CURRENCIES.find((c) => c.code === code);
}

/** Minor-unit digits of a currency; 2 for a code Tally does not list. */
export function currencyDigits(code: string): number {
  return findCurrency(code)?.digits ?? 2;
}

export type DecimalSeparator = "." | ",";

export type ParsedAmount = { ok: true; value: number } | { ok: false; reason: string };

// Currency signs and three-letter codes a bank may put around a number.
const SYMBOLS = /[$€£¥₹₩₽¤]/g;
const SPACES = /[\s\u00a0\u202f']/g;
const CODE_AT_ENDS = /^[A-Z]{3}|[A-Z]{3}$/g;

/**
 * Reads an amount such as "12.34", "-1,234.56", "€ 12,34" (decimal comma),
 * "+5" or "USD 7.00" into minor units. Thousands separators must group by
 * three. More fraction digits than the currency has is an error, never a
 * rounding.
 */
export function parseAmount(text: string, digits: number, decimal: DecimalSeparator = "."): ParsedAmount {
  const raw = text.trim();
  if (raw === "") return { ok: false, reason: "amount is empty" };
  const cleaned = raw.replace(SPACES, "").replace(SYMBOLS, "").replace(CODE_AT_ENDS, "");
  const group = decimal === "." ? "," : ".";
  const shape = new RegExp(`^([+-]?)(\\d{1,3}(?:\\${group}\\d{3})+|\\d+)(?:\\${decimal}(\\d*))?$`);
  const m = shape.exec(cleaned);
  if (!m) return { ok: false, reason: `amount "${raw}" is not a number` };
  const [, sign, whole, fraction = ""] = m;
  if (fraction.length > digits) {
    return { ok: false, reason: `amount "${raw}" has more than ${digits} decimal places` };
  }
  const intDigits = whole.replaceAll(group, "").replace(/^0+(?=\d)/, "");
  if (intDigits.length > 15) return { ok: false, reason: `amount "${raw}" is too large` };
  const minor = Number(intDigits + fraction.padEnd(digits, "0"));
  const value = sign === "-" ? -minor : minor;
  if (Math.abs(value) > MAX_AMOUNT) return { ok: false, reason: `amount "${raw}" is too large` };
  return { ok: true, value: value === 0 ? 0 : value };
}

/** "1,234.56", "-12.34", "1,000" (zero digits). Always "." for decimals. */
export function formatAmount(minor: number, digits: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = String(Math.abs(minor)).padStart(digits + 1, "0");
  const whole = abs.slice(0, abs.length - digits);
  const fraction = digits > 0 ? "." + abs.slice(abs.length - digits) : "";
  return sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + fraction;
}

/** The same amount without grouping, for exports and form fields: "-1234.56". */
export function plainAmount(minor: number, digits: number): string {
  return formatAmount(minor, digits).replaceAll(",", "");
}
