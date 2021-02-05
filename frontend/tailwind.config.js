module.exports = {
  purge: {
    enabled: true,
    content: ["./src/**/*.svelte"],
  },
  variants: {
    extend: {
      borderWidth: ['last']
    }
  }
};
