// L1: money as whole minor units, and calendar dates.
import { describe, expect, it } from "vitest";
import { isValidIsoDate, localIsoDate } from "../../core/dates";
import { currencyDigits, formatAmount, MAX_AMOUNT, parseAmount, parseTypedAmount, plainAmount } from "../../core/money";

const value = (text: string, digits = 2, decimal: "." | "," = ".") => {
  const r = parseAmount(text, digits, decimal);
  return r.ok ? r.value : r.reason;
};

describe("parseAmount", () => {
  it("reads plain, signed and grouped amounts into minor units", () => {
    expect(value("12.34")).toBe(1234);
    expect(value("-12.34")).toBe(-1234);
    expect(value("+5")).toBe(500);
    expect(value("1,234.5")).toBe(123450);
    expect(value("0.07")).toBe(7);
    expect(value("1234567.89")).toBe(123456789);
  });

  it("never goes through floating point: 0.1 + 0.2 style values stay exact", () => {
    expect(value("0.10")).toBe(10);
    expect(value("0.29")).toBe(29);
    expect(value("4.35")).toBe(435); // 4.35 * 100 is 434.99999999999994 in floating point
    expect(value("1.15")).toBe(115);
  });

  it("reads decimal commas, currency signs and codes", () => {
    expect(value("12,34", 2, ",")).toBe(1234);
    expect(value("1.234,56", 2, ",")).toBe(123456);
    expect(value("€ 1 234,56", 2, ",")).toBe(123456);
    expect(value("$-7.00")).toBe(-700);
    expect(value("USD 7.00")).toBe(700);
    expect(value("7.00 EUR")).toBe(700);
  });

  it("follows the currency's digits", () => {
    expect(value("1234", 0)).toBe(1234);
    expect(value("1.234", 3)).toBe(1234);
    expect(value("12.3", 2)).toBe(1230);
  });

  it("rejects what is not an amount, with a reason", () => {
    expect(value("")).toBe("amount is empty");
    expect(value("abc")).toContain("is not a number");
    expect(value("12.345")).toContain("more than 2 decimal places");
    expect(value("12.5", 0)).toContain("more than 0 decimal places");
    expect(value("1,23.45")).toContain("is not a number");
    expect(value("12.34", 2, ",")).toContain("is not a number");
    expect(value("--1")).toContain("is not a number");
    expect(value("99999999999999999")).toContain("too large");
    expect(value(String(MAX_AMOUNT / 100 + 1))).toContain("too large");
  });
});

describe("bank amount formats (bug hunt L2)", () => {
  it("reads a negative in brackets, and a CR or DR suffix", () => {
    expect(value("(12.34)")).toBe(-1234);
    expect(value("($1,234.50)")).toBe(-123450);
    expect(value("12.34 CR")).toBe(1234);
    expect(value("12.34 DR")).toBe(-1234);
    expect(value("1.234,50 dr", 2, ",")).toBe(-123450);
  });

  it("accepts extra decimal places that are all zero, and still refuses real fractions", () => {
    expect(value("1500.00", 0)).toBe(1500);
    expect(value("12.340", 2)).toBe(1234);
    expect(value("1500.50", 0)).toContain("more than 0 decimal places");
    expect(value("12.345", 2)).toContain("more than 2 decimal places");
  });
});

describe("parseTypedAmount (the entry form)", () => {
  const typed = (text: string, digits = 2) => {
    const r = parseTypedAmount(text, digits);
    return r.ok ? r.value : r.reason;
  };

  it("takes a decimal point or a decimal comma", () => {
    expect(typed("12.50")).toBe(1250);
    expect(typed("12,50")).toBe(1250);
    expect(typed("1,250")).toBe(125000);
    expect(typed("1.250,75")).toBe(125075);
    expect(typed("1500", 0)).toBe(1500);
  });

  it("refuses a sign, zero and junk with a sentence the form can show", () => {
    expect(typed("-5")).toBe("Type the amount without a sign; choose Spending or Income.");
    expect(typed("+5")).toBe("Type the amount without a sign; choose Spending or Income.");
    expect(typed("0.00")).toBe("Amount cannot be zero.");
    expect(typed("")).toBe("Amount is empty.");
    expect(typed("12.345")).toBe(`Amount "12.345" has more than 2 decimal places.`);
    expect(typed("twelve")).toBe(`Amount "twelve" is not a number.`);
    expect(typed("(5)")).toBe("Type the amount without a sign; choose Spending or Income.");
  });

  // Bug hunt L9: in a three-decimal currency "1,500" is 1,500.000 or 1.500.
  it("refuses an amount that reads two ways, and takes it once it reads one way", () => {
    expect(typed("1,500", 3)).toBe('Amount "1,500" could mean 1,500.000 or 1.500; type it without a thousands separator.');
    expect(typed("1,500.000", 3)).toBe(1500000);
    expect(typed("1.500", 3)).toBe(1500); // a point is always the decimal separator
    expect(typed("1500", 3)).toBe(1500000);
    expect(typed("1,5", 3)).toBe(1500);
    expect(typed("1,500", 2)).toBe(150000);
    expect(typed("1.500", 0)).toBe('Amount "1.500" has more than 0 decimal places.');
  });
});

describe("formatAmount", () => {
  it("groups thousands and pads the fraction", () => {
    expect(formatAmount(123456, 2)).toBe("1,234.56");
    expect(formatAmount(-5, 2)).toBe("-0.05");
    expect(formatAmount(0, 2)).toBe("0.00");
    expect(formatAmount(1234567, 0)).toBe("1,234,567");
    expect(formatAmount(1234, 3)).toBe("1.234");
    expect(plainAmount(-123456789, 2)).toBe("-1234567.89");
  });

  it("round-trips through parseAmount for every sign and size", () => {
    for (const digits of [0, 2, 3]) {
      for (const n of [1, -1, 9, 10, 99, 100, 101, 999999, -1000000, MAX_AMOUNT, -MAX_AMOUNT]) {
        expect(value(formatAmount(n, digits), digits)).toBe(n);
        expect(value(plainAmount(n, digits), digits)).toBe(n);
      }
    }
  });

  it("knows each currency's minor digits", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("BHD")).toBe(3);
  });
});

describe("dates", () => {
  it("accepts real calendar days only", () => {
    expect(isValidIsoDate("2026-11-18")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2000-02-29")).toBe(true);
    expect(isValidIsoDate("1900-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("2026-1-05")).toBe(false);
    expect(isValidIsoDate("18/11/2026")).toBe(false);
  });

  it("takes the local calendar day of an instant", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
