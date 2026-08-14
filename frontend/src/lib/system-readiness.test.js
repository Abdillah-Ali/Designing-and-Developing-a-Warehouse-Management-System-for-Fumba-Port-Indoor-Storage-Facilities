import { describe, expect, it } from "vitest";
import { getSystemReadinessPresentation } from "./system-readiness";

describe("system readiness presentation", () => {
  it("renders configuration-required without treating the backend as offline", () => {
    expect(getSystemReadinessPresentation({overall:"configuration_required",domains:{tariff:{issues:[{code:"NO_ACTIVE_USABLE_TARIFF"}]}}})).toEqual({tone:"warning",title:"Configuration required",backendOnline:true});
  });

  it("uses backend status rather than calculating tariff readiness", () => {
    expect(getSystemReadinessPresentation({overall:"healthy",domains:{tariff:{ready:false}}}).title).toBe("Operations ready");
  });

  it("does not use human-readable issue messages as execution authority", () => {
    expect(getSystemReadinessPresentation({overall:"configuration_required",issues:[{message:"Everything is healthy"}]}).title).toBe("Configuration required");
  });
});
