import fs from 'fs';
import { sep } from 'path';

import { Configuration } from './types';

/**
 * Search for `filename` from `path` and up to all its parents.
 */
export function findFileFromPathAndParents(filename: string | undefined | null, path?: string) {
  if (!filename) return [];
  // Absolute path: /path/to/file or C:\path\to\file
  if (/^(\/|[a-zA-Z]:\\)/.test(filename)) return [filename];
  if (!path) return [];
  const comp = path.split(/[\\/]+/);
  if (isRegularFile(path)) comp.pop();
  const results = [];
  for (; comp.length > 0; comp.pop()) {
    const n = `${comp.join(sep)}${sep}${filename}`;
    if (isRegularFile(n)) results.push(n);
  }
  return results;
}

/**
 * Test if `path` exists and is a regular file.
 */
function isRegularFile(path: string) {
  return fs.existsSync(path) && fs.statSync(path).isFile();
}

/**
 * Get parent folder for a file. It's different from `path.join(fileName, '..')`.
 */
export function parentFolder(fileName: string | undefined | null) {
  if (!fileName) return '';
  const p = fileName.replace(/\/+/g, '/').replace(/\\+/g, '\\');
  const i = p.search(/[\\/][^\\/]*$/);
  if (i < 0) return '';
  if (i === 0) return /[\\/]$/.test(p) ? '' : p.substr(0, 1);
  return p.substr(0, i);
}

/**
 * Properties in `Configuration` that need to be merged instead of replaced.
 */
const KEYS_TO_MERGE = [
  'exclude' as const,
  'excludeGlob' as const,
  'sortRules' as const,
  'keepUnused' as const,
];

/**
 * Merge multiple configs together. The latter takes precedence if values have conflicts.
 *
 * This function is preferred to `{...config1, ...config2}` in a sense that some keys need to be
 * merged instead of overwritten, e.g. `exclude`.
 *
 * Example:
 * ```ts
 * const config1 = { maxLineLength: 80, tabSize: 2 };
 * const config2 = { maxLineLength: 100 };
 *
 * const config = mergeConfig(config1, config2);  // { maxLineLength: 100, tabSize: 2 }
 * ```
 * @typeparam T A type extended from Configuration
 *
 * @param configs An array of config objects
 */
export function mergeConfig<T extends Configuration>(...configs: T[]) {
  return configs.reduce((a, b) => {
    const obj = KEYS_TO_MERGE.map(k => {
      const e1 = a[k];
      const e2 = b[k];
      return {
        [k]: !e1
          ? e2
          : !e2
          ? e1
          : Array.isArray(e1) && Array.isArray(e2)
          ? [...e1, ...e2]
          : { ...e1, ...e2 },
      };
    }).reduce((v1, v2) => ({ ...v1, ...v2 }));

    return { ...purify(a), ...purify(b), ...purify(obj) };
  });
}

function purify<T extends object>(a: T): T {
  let r = {} as T;
  let k: keyof T;
  for (k in a) if (a[k] !== undefined) r = { ...r, [k]: a[k] };
  return r;
}
