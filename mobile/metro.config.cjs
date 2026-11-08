/* global require, module, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Metro loads this CommonJS configuration. */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// The clients share the bounded SSE parser without importing backend services.
config.watchFolders = [path.resolve(__dirname, '../src/shared')];
module.exports = config;
