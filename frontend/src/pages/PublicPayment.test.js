import { describe,expect,it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("public installment payment page",()=>{
  const app=fs.readFileSync(path.resolve(process.cwd(),"src/App.jsx"),"utf8");
  const page=fs.readFileSync(path.resolve(process.cwd(),"src/pages/PublicPayment.jsx"),"utf8");
  it("is routed outside WMS portal authentication",()=>expect(app).toContain('path="/pay/:token"'));
  it("supports responsive layouts and never collects a PIN",()=>{expect(page).toContain("sm:grid-cols");expect(page).not.toMatch(/type=["']password|PIN.*input/i)});
  it("handles complete payment and token-scoped APIs",()=>{expect(page).toContain("Payment Complete");expect(page).toContain("getPublicPaymentSummary");expect(page).toContain("createPublicPaymentAttempt")});
  it("uses Pay Now to redirect the same tab to provider authorization and restores the attempt on return",()=>{expect(page).toContain("window.location.assign(redirectUrl)");expect(page).toContain('searchParams.get("attempt")');expect(page).not.toContain("Continue to Flutterwave Sandbox Authorization")});
});
