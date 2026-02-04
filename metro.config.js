const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

config.resolver.sourceExts = config.resolver.sourceExts.filter(
  (ext) => ext !== "svg"
);
if (!config.resolver.assetExts.includes("svg")) {
  config.resolver.assetExts.push("svg");
}

if (!config.resolver.assetExts.includes("txt")) {
  config.resolver.assetExts.push("txt");
}

module.exports = config;
