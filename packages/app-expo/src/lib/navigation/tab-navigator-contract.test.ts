import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigator = readFileSync(
  new URL("../../navigation/TabNavigator.tsx", import.meta.url),
  "utf8",
);

describe("native tab navigator contract", () => {
  it("keeps search as a separate iOS control with a custom icon and no labels", () => {
    const searchTab = navigator.slice(
      navigator.indexOf('name="Search"'),
      navigator.indexOf("</Tab.Navigator>"),
    );

    expect(navigator).toContain('tabBarLabelVisibilityMode: "unlabeled"');
    expect(navigator.match(/tabBarLabel: ""/g)).toHaveLength(4);
    expect(searchTab).toContain('tabBarLabel: ""');
    expect(searchTab).toContain("tabBarIcon: tabIcon(TAB_ICONS.Search)");
    expect(searchTab).toContain('tabBarSystemItem: Platform.OS === "ios" ? "search" : undefined');
  });
});
