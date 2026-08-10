const { withPodfile } = require("expo/config-plugins");

const GAMMA_FLAG = "ENV['RNS_GAMMA_ENABLED'] = '1'";

module.exports = function withReactNativeScreensGamma(config) {
  return withPodfile(config, (podfileConfig) => {
    if (!podfileConfig.modResults.contents.includes(GAMMA_FLAG)) {
      podfileConfig.modResults.contents = podfileConfig.modResults.contents.replace(
        "require 'json'",
        `require 'json'\n\n${GAMMA_FLAG}`,
      );
    }

    return podfileConfig;
  });
};
