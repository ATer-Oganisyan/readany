const interfaceFontAssets = {
  "SB Sans Interface": require("./fonts/SBSansUI-Regular.otf"),
  "SB Sans Interface Light": require("./fonts/SBSansUI-Light.otf"),
  "SB Sans Interface Semibold": require("./fonts/SBSansUI-Semibold.otf"),
  "SB Sans Interface Bold": require("./fonts/SBSansUI-Bold.otf"),
  "SB Sans Interface Caps": require("./fonts/SBSansUI-Caps.otf"),
  "SB Sans Display Semibold": require("./fonts/SBSansDisplay-SemiBold.otf"),
  "Material Symbols Rounded": require("./fonts/MaterialSymbolsRounded-Variable.ttf"),
};

module.exports = {
  interfaceFontAssets,
  interfaceFontFamily: {
    regular: "SB Sans Interface",
    light: "SB Sans Interface Light",
    semibold: "SB Sans Interface Semibold",
    bold: "SB Sans Interface Bold",
    caps: "SB Sans Interface Caps",
    materialSymbols: "Material Symbols Rounded",
  },
  displayFontFamily: {
    semibold: "SB Sans Display Semibold",
  },
};
