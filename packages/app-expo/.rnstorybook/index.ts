import { view } from "./storybook.requires";

const StorybookUIRoot = view.getStorybookUI({
  shouldPersistSelection: true,
  enableWebsockets: false,
});

export default StorybookUIRoot;
