import { describe, expect, it } from "vitest";
import { maskAccountNumber, toBankDetails } from "./bank";

const bank = { bankName: "GTBank", accountName: "Ada Obi", accountNumber: "0123456789" };

describe("maskAccountNumber", () => {
  it("keeps only the last four digits", () => {
    expect(maskAccountNumber("0123456789")).toBe("******6789");
  });

  it("does not throw on a short number", () => {
    expect(maskAccountNumber("12")).toBe("12");
  });
});

describe("toBankDetails", () => {
  it("omits the full number unless revealed", () => {
    const details = toBankDetails(bank, false);
    expect(details).toEqual({ bankName: "GTBank", accountName: "Ada Obi", maskedNumber: "******6789" });
    expect(JSON.stringify(details)).not.toContain("0123456789");
  });

  it("includes the full number when revealed", () => {
    expect(toBankDetails(bank, true)).toMatchObject({ maskedNumber: "******6789", fullNumber: "0123456789" });
  });

  it("is null when any bank field is missing", () => {
    expect(toBankDetails({ ...bank, accountNumber: null }, true)).toBeNull();
  });
});
