const fs = require("node:fs");
const path = require("node:path");
const { withFinalizedMod } = require("@expo/config-plugins");
const { Builder, Parser } = require("xml2js");

const LOGO_CONTENTS = {
  images: [
    {
      filename: "splash-logo.svg",
      idiom: "universal",
    },
    {
      appearances: [{ appearance: "luminosity", value: "dark" }],
      filename: "splash-logo-dark.svg",
      idiom: "universal",
    },
  ],
  info: {
    author: "xcode",
    version: 1,
  },
  properties: {
    "preserves-vector-representation": true,
  },
};

module.exports = function withBottomSplashScreen(config) {
  return withFinalizedMod(config, [
    "ios",
    async (cfg) => {
      const nativeTargetRoot = path.join(
        cfg.modRequest.platformProjectRoot,
        cfg.modRequest.projectName,
      );
      const storyboardPath = path.join(nativeTargetRoot, "SplashScreen.storyboard");
      const logoImagesetRoot = path.join(
        nativeTargetRoot,
        "Images.xcassets",
        "SplashLogo.imageset",
      );
      const sourceAssetsRoot = path.join(cfg.modRequest.projectRoot, "assets");

      const document = await new Parser().parseStringPromise(
        fs.readFileSync(storyboardPath, "utf8"),
      );
      const mainView = document.document.scenes[0].scene[0].objects[0].viewController[0].view[0];
      const imageView = mainView.subviews[0].imageView.find(
        (candidate) => candidate.$.id === "EXPO-SplashScreen",
      );

      if (!imageView) {
        throw new Error("withBottomSplashScreen: EXPO-SplashScreen image view not found");
      }

      imageView.$.image = "SplashLogo";
      imageView.$.userLabel = "SplashLogo";
      imageView.rect[0].$ = {
        key: "frame",
        x: "124.5",
        y: "650",
        width: "144",
        height: "144",
      };

      mainView.constraints[0].constraint = [
        {
          $: {
            firstItem: "EXPO-SplashScreen",
            firstAttribute: "centerX",
            secondItem: "EXPO-ContainerView",
            secondAttribute: "centerX",
            id: "EXPO-SplashLogo-CenterX",
          },
        },
        {
          $: {
            firstItem: "EXPO-SplashScreen",
            firstAttribute: "bottom",
            secondItem: "Rmq-lb-GrQ",
            secondAttribute: "bottom",
            constant: "-24",
            id: "EXPO-SplashLogo-Bottom",
          },
        },
        {
          $: {
            firstItem: "EXPO-SplashScreen",
            firstAttribute: "width",
            constant: "144",
            id: "EXPO-SplashLogo-Width",
          },
        },
        {
          $: {
            firstItem: "EXPO-SplashScreen",
            firstAttribute: "height",
            constant: "144",
            id: "EXPO-SplashLogo-Height",
          },
        },
      ];

      document.document.resources[0].image = [
        {
          $: {
            name: "SplashLogo",
            width: "144",
            height: "144",
          },
        },
      ];

      fs.writeFileSync(
        storyboardPath,
        new Builder({
          xmldec: { version: "1.0", encoding: "UTF-8" },
          renderOpts: { pretty: true, indent: "    " },
        }).buildObject(document),
      );

      fs.mkdirSync(logoImagesetRoot, { recursive: true });
      fs.copyFileSync(
        path.join(sourceAssetsRoot, "splash-logo.svg"),
        path.join(logoImagesetRoot, "splash-logo.svg"),
      );
      fs.copyFileSync(
        path.join(sourceAssetsRoot, "splash-logo-dark.svg"),
        path.join(logoImagesetRoot, "splash-logo-dark.svg"),
      );
      fs.writeFileSync(
        path.join(logoImagesetRoot, "Contents.json"),
        `${JSON.stringify(LOGO_CONTENTS, null, 2)}\n`,
      );

      return cfg;
    },
  ]);
};
