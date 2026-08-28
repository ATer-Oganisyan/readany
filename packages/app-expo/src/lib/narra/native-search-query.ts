/** UISearchBar emits cancel followed by an empty change. Navigation must retain the draft. */
export class NativeSearchQuery {
  private value = "";
  private cancelled = false;

  get(): string {
    return this.value;
  }

  cancel(): void {
    this.cancelled = true;
  }

  focus(): string {
    this.cancelled = false;
    return this.value;
  }

  change(text: string): { query: string; restore: boolean } {
    if (this.cancelled && text === "") {
      this.cancelled = false;
      return { query: this.value, restore: true };
    }
    this.cancelled = false;
    this.value = text;
    return { query: text, restore: false };
  }
}
