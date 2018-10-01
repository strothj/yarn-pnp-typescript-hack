import fs from "fs";
import path from "path";

const typescriptPackageJsonFileName = require.resolve(
  "typescript/package.json",
);

const typescriptVersion = JSON.parse(
  fs.readFileSync(typescriptPackageJsonFileName, "utf8"),
).version;

const outDirectory = path.resolve(
  __dirname,
  "../../kitchen-sink/resolvers/typescript",
);

fs.mkdirSync(outDirectory);

fs.writeFileSync(
  path.join(outDirectory, "package.json"),
  `${JSON.stringify({ version: typescriptVersion }, null, 2)}\n`,
  "utf8",
);
