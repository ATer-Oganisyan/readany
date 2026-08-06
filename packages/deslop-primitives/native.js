const interfaceFontAssets = {
  "SB Sans Interface": require("./fonts/SBSansUI-Regular.otf"),
  "SB Sans Interface Light": require("./fonts/SBSansUI-Light.otf"),
  "SB Sans Interface Semibold": require("./fonts/SBSansUI-Semibold.otf"),
  "SB Sans Interface Bold": require("./fonts/SBSansUI-Bold.otf"),
  "SB Sans Interface Caps": require("./fonts/SBSansUI-Caps.otf"),
  "SB Sans Display Semibold": require("./fonts/SBSansDisplay-SemiBold.otf"),
  "Material Symbols Rounded": require("./fonts/MaterialSymbolsRounded-Variable.ttf"),
};

const serifTextFontAssets = {
  regular: require("./fonts/SBSerifText-Regular.otf"),
  italic: require("./fonts/SBSerifText-Italic.otf"),
  bold: require("./fonts/SBSerifText-Bold.otf"),
  boldItalic: require("./fonts/SBSerifText-BoldItalic.otf"),
};

const serifCondensedFontAssets = {
  regular: require("./fonts/SBSerifCondensed.otf"),
};

const sansCondensedFontAssets = {
  regular: require("./fonts/SBSansTextCond-Regular.ttf"),
  bold: require("./fonts/SBSansTextCond-Bold.ttf"),
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
  sansCondensedFontAssets,
  sansCondensedFontFamily: {
    regular: "SB Sans Text Cond",
    bold: "SB Sans Text Cond Bold",
  },
  roundedFontFamily: {
    regular: "SF Pro Rounded",
    semibold: "SF Pro Rounded",
    bold: "SF Pro Rounded",
  },
  serifTextFontAssets,
  serifTextFontFamily: {
    regular: "SB Serif Text",
    italic: "SB Serif Text Italic",
    bold: "SB Serif Text Bold",
    boldItalic: "SB Serif Text Bold Italic",
  },
  serifCondensedFontAssets,
  serifCondensedFontFamily: {
    regular: "SB Serif Condensed",
  },
};
