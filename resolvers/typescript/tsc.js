const fs = require("fs");
const path = require("path");

let pnp = null;

try {
  pnp = require(`pnpapi`);
} catch (e) {
  // not in PnP; not a problem
}

const pnpResolverFileName = path.resolve(__dirname, "../../.pnp.js");
if (!pnp && fs.existsSync(pnpResolverFileName)) {
  pnp = require(pnpResolverFileName);
  pnp.setup();
}

const tscModuleFileName = require.resolve("typescript/lib/tsc.js");
const tscModuleDirectory = path.dirname(tscModuleFileName);
const tscModuleCode = fs.readFileSync(tscModuleFileName, "utf8");

__dirname = tscModuleDirectory;
__filename = tscModuleFileName;

function createProgram(rootNamesOrOptions, _options) {
  const createProgramOptions = ts.isArray(rootNamesOrOptions)
    ? createCreateProgramOptions(rootNamesOrOptions, _options)
    : rootNamesOrOptions;
  const { rootNames, options } = createProgramOptions;

  const injectedHost = createCompilerHost(options);

  if (pnp) {
    injectedHost.resolveModuleNames = (moduleNames, containingFile) => {
      const resolutions = moduleNames.map(moduleName => {
        const resolvedModuleDirectory = pnp.resolveToUnqualified(
          moduleName,
          containingFile
        );
        if (!resolvedModuleDirectory) return undefined;

        const pnpPackageLocator = pnp.findPackageLocator(
          `${resolvedModuleDirectory}${path.sep}package.json`
        );

        const isExternalLibraryImport =
          pnpPackageLocator && pnpPackageLocator.name !== null;

        const resolutionResult = ts.nodeModuleNameResolver(
          moduleName,
          isExternalLibraryImport
            ? path.resolve(resolvedModuleDirectory, "../../index.ts")
            : containingFile,
          options,
          injectedHost
        );

        console.log(resolutionResult);

        return resolutionResult.resolvedModule;
      });

      return resolutions;
    };
  }

  return createProgramNative({
    rootNames,
    options,
    host: injectedHost
  });
}

let modifiedCode = tscModuleCode.replace(
  "function createProgram",
  "function createProgramNative"
);
modifiedCode = modifiedCode.replace(
  "ts.createProgram = createProgram;",
  `
  ${createProgram.toString()};
  ts.createProgram = createProgram;
  `
);

eval(modifiedCode);
