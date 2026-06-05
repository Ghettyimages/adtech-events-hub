// Preload: neutralize `server-only` so server modules can run under tsx/node.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'server-only') return {};
  return origLoad.apply(this, [request, ...rest]);
};
