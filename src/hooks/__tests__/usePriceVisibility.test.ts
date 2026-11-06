import { describe, expect, it } from "vitest";
import { resolvePriceVisibility } from "@/hooks/usePriceVisibility";

describe("resolvePriceVisibility", () => {
  it("never enables fees when the deployment has not published them", () => {
    expect(resolvePriceVisibility(false, null)).toBe(false);
    expect(resolvePriceVisibility(false, "visible")).toBe(false);
    expect(resolvePriceVisibility(false, "hidden")).toBe(false);
  });

  it("allows screenshot masking of fees that the deployment has published", () => {
    expect(resolvePriceVisibility(true, null)).toBe(true);
    expect(resolvePriceVisibility(true, "visible")).toBe(true);
    expect(resolvePriceVisibility(true, "hidden")).toBe(false);
  });
});
