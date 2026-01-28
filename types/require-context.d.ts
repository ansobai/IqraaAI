export {};

declare global {
  interface NodeRequire {
    context(
      path: string,
      recursive: boolean,
      filter: RegExp
    ): {
      keys(): string[];
      <T = unknown>(id: string): T;
    };
  }
}
