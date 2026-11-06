import { describe, expect, it } from "vitest";
import { shouldRenderHomepagePingBars } from "@/hooks/useNodeCardModel";

describe("homepage ping bar visibility", () => {
  it("keeps automatically discovered ping bars visible without a saved binding", () => {
    expect(shouldRenderHomepagePingBars(false, true)).toBe(true);
    expect(shouldRenderHomepagePingBars(false, false)).toBe(false);
    expect(shouldRenderHomepagePingBars(true, false)).toBe(true);
  });
});
