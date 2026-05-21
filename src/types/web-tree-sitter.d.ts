declare module 'web-tree-sitter' {
  const Parser: {
    default: {
      init(): Promise<void>;
      Language: {
        load(path: string): Promise<any>;
      };
    };
  };
  export default Parser;
}
