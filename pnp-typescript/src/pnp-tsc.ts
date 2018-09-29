type TypeScriptModule = typeof import("typescript");
type CreateProgramOptions = import("typescript").CreateProgramOptions;
type Diagnostic = import("typescript").Diagnostic;
type CompilerOptions = import("typescript").CompilerOptions;
type CompilerHost = import("typescript").CompilerHost;
type Program = import("typescript").Program;
// type ResolvedModule = import("typescript").ResolvedModule;

// tslint:disable-next-line:no-var-keyword prefer-const
var ts!: TypeScriptModule;

// tslint:disable-next-line:no-shadowed-variable
(function(ts: TypeScriptModule) {
  const fs: typeof import("fs") = require("fs");
  const path: typeof import("path") = require("path");

  const tscModuleFileName = require.resolve("typescript/lib/tsc.js");
  const tscModuleDirectory = path.dirname(tscModuleFileName);
  const tscModuleCode = fs.readFileSync(tscModuleFileName, "utf8");

  // Override these so path resolution to TypeScript standard library files
  // can work as expected.
  // @ts-ignore
  __dirname = tscModuleDirectory;
  // @ts-ignore
  __filename = tscModuleFileName;

  // If Yarn Plug'n'Play does not exist in the environment, avoid the monkey
  // patching and continue with normal behavior.
  const pnp = getPnpInstance()!;
  if (!pnp) {
    // tslint:disable-next-line:no-eval
    eval(tscModuleCode);
    return;
  }

  checkPnpImplementationVersion();

  // Here we implement a replacement for TypeScript's createProgram function. We
  // create a custom CompilerHost with an implementation for resolveModuleNames.
  // TypeScript/src/compiler/program.ts
  function createProgram(
    rootNamesOrOptions: ReadonlyArray<string> | CreateProgramOptions,
    options_?: CompilerOptions,
    host_?: CompilerHost,
    oldProgram_?: Program,
    configFileParsingDiagnostics_?: ReadonlyArray<Diagnostic>,
  ): Program {
    const createProgramOptions: CreateProgramOptions = Array.isArray(
      rootNamesOrOptions,
    )
      ? createCreateProgramOptions(
          rootNamesOrOptions,
          options_!,
          host_,
          oldProgram_,
          configFileParsingDiagnostics_,
        )
      : (rootNamesOrOptions as CreateProgramOptions);

    const {
      rootNames,
      options,
      configFileParsingDiagnostics,
    } = createProgramOptions;

    options.typeRoots = options.typeRoots || [];

    // List of @types packages to add to CompilerOption's typeRoots.
    const typePackages: YarnPackageReference[] = [];

    // Add all @types dependencies of all dependencies to queue.
    // TODO: Pick the highest version @types package instead of the first found.
    const queueTypePackage = (packageReference: YarnPackageReference) => {
      const packageInformation = pnp.getPackageInformation(packageReference);
      if (!packageInformation) return;

      const packageDependencies = Array.from(
        packageInformation.packageDependencies.entries(),
      );

      packageDependencies.forEach(([name, reference]) => {
        if (/^@types/.test(name) && !typePackages.find(d => d.name === name)) {
          typePackages.push({ name, reference });
          queueTypePackage({ name, reference });
        }
      });
    };
    queueTypePackage(pnp.topLevel);

    typePackages.forEach(packageReference => {
      const packageInformation = pnp.getPackageInformation(packageReference);
      if (!packageInformation) return;
      options.typeRoots!.push(
        path.resolve(packageInformation.packageLocation, ".."),
      );
    });

    const hostWithPnpResolver = createCompilerHost(options);

    hostWithPnpResolver.resolveModuleNames = (moduleNames, containingFile) => {
      const resolutions = moduleNames.map(moduleName => {
        const resolvedModuleDirectory = pnp.resolveToUnqualified(
          moduleName,
          containingFile,
        );
        if (!resolvedModuleDirectory) return undefined;

        const pnpPackageLocator = pnp.findPackageLocator(
          `${resolvedModuleDirectory}${path.sep}package.json`,
        );

        const isExternalLibraryImport =
          pnpPackageLocator && pnpPackageLocator.name !== null;

        const { resolvedModule } = ts.nodeModuleNameResolver(
          moduleName,
          isExternalLibraryImport
            ? path.resolve(resolvedModuleDirectory, "../../index.ts")
            : containingFile,
          options,
          hostWithPnpResolver,
        );

        return resolvedModule;
      });

      return resolutions;
    };

    return createProgramOriginal(
      rootNames,
      options,
      hostWithPnpResolver,
      oldProgram_,
      configFileParsingDiagnostics,
    );
  }

  let monkeyPatchedTscModuleCode = tscModuleCode.replace(
    "function createProgram",
    "function createProgramOriginal",
  );
  monkeyPatchedTscModuleCode = monkeyPatchedTscModuleCode.replace(
    "ts.createProgram = createProgram;",
    `
    ${createProgram.toString()};
    ts.createProgram = createProgram;
    `,
  );

  // tslint:disable-next-line:no-eval
  eval(monkeyPatchedTscModuleCode);

  /**
   * Reuse an existing instance of Yarn Plug'n'Play if it exists, otherwise
   * attempt to require it.
   */
  function getPnpInstance(): YarnPlugNPlay | null {
    let pnpInstance: YarnPlugNPlay | null = null;

    try {
      // tslint:disable-next-line:no-implicit-dependencies
      pnpInstance = require("pnpapi");
    } catch {
      // It's okay if an error is thrown here. Yarn Plug'n'Play intercepts the
      // require when it is loaded in the environment.
    }
    if (pnpInstance) return pnpInstance;

    const pnpResolverFileName = path.resolve(process.cwd(), ".pnp.js");
    if (!fs.existsSync(pnpResolverFileName)) return null;

    pnpInstance = require(pnpResolverFileName) as YarnPlugNPlay;
    pnpInstance.setup();

    return pnpInstance;
  }

  /**
   * Throw an error is the Yarn Plug'n'Play resolver api version is not
   * supported.
   */
  function checkPnpImplementationVersion() {
    if (pnp.VERSIONS.std !== 1) {
      throw new Error(
        `Unsupported Yarn Plug'n'Play api version: ${
          pnp.VERSIONS.std
        }. Only version 1 is supported.`,
      );
    }
  }
})(ts || {});

interface YarnPackageReference {
  name: string | null;
  reference: string | null;
}

interface YarnPackageInformation {
  packageLocation: string;
  packageDependencies: Map<string, string>;
}

interface YarnPlugNPlay {
  /**
   * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
   * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
   * to override the standard, and can only offer new methods.
   *
   * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
   * functions, they'll just have to fix the conflicts and bump their own version number.
   */
  VERSIONS: { std: 1 };

  /**
   * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
   * This path is called "unqualified" because it only changes the package name to the package location on the disk,
   * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
   * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
   * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
   *
   * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
   * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
   * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
   */
  resolveToUnqualified: (
    request: string,
    issuer: string,
    options?: Partial<{ considerBuiltins: boolean }>,
  ) => string;

  findPackageLocator: (location: string) => YarnPackageReference;

  /**
   * Setups the hook into the Node environment.
   *
   * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
   * be used as path of the file to load.
   */
  setup: () => void;

  /**
   * Useful when used together with getPackageInformation to fetch information about the top-level package.
   */
  topLevel: YarnPackageReference;

  getPackageInformation: (
    packageReference: YarnPackageReference,
  ) => YarnPackageInformation | null;
}

// Force treatment of this file as a module so we can augment globally.
export {};

declare global {
  var createCreateProgramOptions: (
    rootNames: ReadonlyArray<string>,
    options: CompilerOptions,
    host?: CompilerHost | undefined,
    oldProgram?: Program | undefined,
    configFileParsingDiagnostics?: ReadonlyArray<Diagnostic> | undefined,
  ) => CreateProgramOptions;
  var createCompilerHost: (
    options: CompilerOptions,
    setParentNodes?: boolean | undefined,
  ) => CompilerHost;
  var createProgramOriginal: typeof import("typescript").createProgram;
}
