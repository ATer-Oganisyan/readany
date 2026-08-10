const { withPodfile } = require("expo/config-plugins");

const MINIMUM_IOS_VERSION = "16.4";
const MARKER = "# narra: normalize pod deployment targets";
const SOURCE_BUILD_MARKER = "# narra: honor React Native source-build setting";

module.exports = function withIosPodsDeploymentTarget(config) {
  return withPodfile(config, (podfileConfig) => {
    if (!podfileConfig.modResults.contents.includes(SOURCE_BUILD_MARKER)) {
      const propertiesAnchor = /(podfile_properties = JSON\.parse\([^\n]+\) rescue \{\}\n)/;
      if (!propertiesAnchor.test(podfileConfig.modResults.contents)) {
        throw new Error("withIosPodsDeploymentTarget: Podfile properties anchor not found");
      }

      const sourceBuildOverride = `
${SOURCE_BUILD_MARKER}
if podfile_properties['newArchEnabled'] != 'false' && podfile_properties['ios.buildReactNativeFromSource'] == 'true'
  ENV['RCT_USE_RN_DEP'] = '0'
  ENV['RCT_USE_PREBUILT_RNCORE'] = '0'
end
`;

      podfileConfig.modResults.contents = podfileConfig.modResults.contents.replace(
        propertiesAnchor,
        `$1${sourceBuildOverride}`,
      );
    }

    if (!podfileConfig.modResults.contents.includes(MARKER)) {
      const postInstallAnchor = /(\n {4}react_native_post_install\([\s\S]*?\n {4}\))(?=\n {2}end)/;
      if (!postInstallAnchor.test(podfileConfig.modResults.contents)) {
        throw new Error("withIosPodsDeploymentTarget: react_native_post_install anchor not found");
      }

      const deploymentTargetOverride = `

    ${MARKER}
    installer.pods_project.targets.each do |pod_target|
      pod_target.build_configurations.each do |build_configuration|
        build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MINIMUM_IOS_VERSION}'
      end
    end`;

      podfileConfig.modResults.contents = podfileConfig.modResults.contents.replace(
        postInstallAnchor,
        `$1${deploymentTargetOverride}`,
      );
    }

    return podfileConfig;
  });
};
