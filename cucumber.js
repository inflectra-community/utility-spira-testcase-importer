export default {
  default: {
    import: ['features/support/setup.ts'],
    format: ['@cucumber/pretty-formatter'],
    paths: ['features/**/*.feature'],
  },
};
