import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Finance Flutterwave initiation", () => {
  it("exposes the existing gateway API from payable issued invoices", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "pages", "FinancePortal.jsx"), "utf8");
    expect(source).toContain("Pay with Flutterwave");
    expect(source).toContain("initiateGatewayPayment(gateway.invoice.invoice_number, customer)");
    expect(source).toContain("Continue Sandbox Authorization");
    expect(source).toContain("payment_instruction?.note");
  });
});
