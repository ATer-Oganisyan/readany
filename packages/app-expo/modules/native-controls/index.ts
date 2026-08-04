import { NativeModule, requireNativeModule } from "expo";

declare class ReadAnyNativeControlsModule extends NativeModule {
  promptForText(
    title: string,
    message: string,
    placeholder: string,
    cancelLabel: string,
    confirmLabel: string,
  ): Promise<string | null>;
}

export default requireNativeModule<ReadAnyNativeControlsModule>("ReadAnyNativeControls");
