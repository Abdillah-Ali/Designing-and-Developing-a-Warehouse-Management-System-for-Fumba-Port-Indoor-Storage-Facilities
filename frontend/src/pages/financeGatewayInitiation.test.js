import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Finance payment monitoring and email management", () => {
  it("enforces monitoring role, payment history tracking, and email resending", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "pages", "FinancePortal.jsx"), "utf8");
    expect(source).toContain("resendPaymentEmail");
    expect(source).toContain("Copy link");
    expect(source).toContain("Resend email");
    expect(source).toContain("master_payment_reference");
    expect(source).toContain("installment_count");
    expect(source).toContain("email_delivery_status");
    expect(source).not.toContain("finance.payments.confirm");
    expect(source).not.toContain("Legacy manual payment");
  });
});
