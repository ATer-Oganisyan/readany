const { withPodfile } = require("@expo/config-plugins");

const MINIMUM_IOS_VERSION = "15.1";
const MARKER = "# narra: normalize pod deployment targets";

module.exports = function withIosPodsDeploymentTarget(config) {
  return withPodfile(config, (podfileConfig) => {
    if (podfileConfig.modResults.contents.includes(MARKER)) {
      return podfileConfig;
    }

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

    return podfileConfig;
  });
};
