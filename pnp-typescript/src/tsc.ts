import { readFileSync } from "fs";
import { join } from "path";

// tslint:disable-next-line:no-eval
eval(readFileSync(join(__dirname, "./resolver.js"), "utf8"));
