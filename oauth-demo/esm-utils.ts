import { fileURLToPath } from "url";
import path from "path";

export const __dirname = (metaUrl: string) =>
  path.dirname(fileURLToPath(metaUrl));
