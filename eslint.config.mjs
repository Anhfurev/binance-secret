import eslintConfigNext from "eslint-config-next";

const eslintConfig = [
  {
    ignores: [
      "freqtrade-strategies-main/**",
      "User/**",
      ".cursor/**",
    ],
  },
  ...eslintConfigNext,
];

export default eslintConfig;
