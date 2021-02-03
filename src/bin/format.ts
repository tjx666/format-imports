import fs from 'fs-extra';
import path from 'path';
import tmp from 'tmp';

import {
  formatSource,
  isFileExcludedByConfig,
  resolveConfigForFile,
} from '../lib';
import {
  isSupported,
  loadBaseConfig,
} from './config';
import { Options } from './options';
import { getFiles } from './utils';

enum OutputMode {
  NORMAL,
  DRY_RUN_FILE,
  DRY_RUN_FILES,
  DRY_RUN_DIR,
}
function dryRunOutput(
  mode: OutputMode,
  result: string | undefined,
  source: string,
  inputFile?: string | undefined,
) {
  if (mode === OutputMode.DRY_RUN_FILES) {
    if (result !== undefined && inputFile)
      process.stdout.write(`'${inputFile}' will be modified.\n`);
  } else if (mode === OutputMode.DRY_RUN_FILE) process.stdout.write(result ?? source);
}

function checkFileContent(
  filePath: string,
  text: string,
): { exist: boolean; isFile?: boolean; equal?: boolean } {
  const exist = fs.existsSync(filePath);
  if (!exist) return { exist };
  const stat = fs.statSync(filePath);
  const isFile = stat.isFile();
  if (!isFile) return { exist, isFile };
  if (stat.size !== text.length) return { exist, isFile, equal: false };
  const content = fs.readFileSync(filePath).toString();
  return { exist, isFile, equal: text === content };
}

function outputResult(
  mode: OutputMode,
  result: string | undefined,
  outputFile: string | undefined,
  source: string,
  inputFile?: string,
): { error?: boolean; modified?: number; created?: number } {
  if (outputFile) {
    const text = result ?? source;
    const { exist, isFile, equal } = checkFileContent(outputFile, text);
    if (exist && !isFile) {
      process.stderr.write(`Option output: '${outputFile}' is not a file.\n`);
      return { error: true };
    }
    if (mode === OutputMode.NORMAL) {
      if (!equal) fs.outputFileSync(outputFile, text);
    } else dryRunOutput(mode, result, source);
    return exist ? { modified: equal ? 0 : 1 } : { created: 1 };
  } else if (inputFile) {
    if (mode === OutputMode.NORMAL) {
      if (result !== undefined) fs.writeFileSync(inputFile, result);
    } else dryRunOutput(mode, result, source, inputFile);
    return { modified: result !== undefined ? 1 : 0 };
  } else dryRunOutput(OutputMode.DRY_RUN_FILE, result, source);
  return {};
}

function ensureOutputDir(output: string | undefined, dryRun: boolean | undefined) {
  if (!output) return;
  if (!fs.existsSync(output)) {
    if (!dryRun) fs.mkdirSync(output, { recursive: true });
  } else if (!fs.statSync(output).isDirectory()) {
    process.stderr.write(`Option output: '${output}' is not a directory.\n`);
    process.exit(1);
  }
}

function processStdin(options: Options) {
  const { output, dryRun } = options;
  const config = loadBaseConfig(options);
  const chunks: string[] = [];
  process.stdin.on('data', data => chunks.push(data.toString()));
  process.stdin.on('end', () => {
    const source = chunks.join();
    if (!source) return;
    tmp.setGracefulCleanup();
    const ext = getExt(options);
    const { fd, name } = tmp.fileSync({ prefix: 'format-imports', postfix: `.${ext}` });
    fs.writeSync(fd, source);
    const result = formatSource(name, source, { config });
    const mode = dryRun ? OutputMode.DRY_RUN_FILE : OutputMode.NORMAL;
    const { error, modified, created } = outputResult(mode, result, output, source);
    if (error) process.exit(1);
    if (mode === OutputMode.NORMAL && output) summary(mode, modified ?? 0, created ?? 0);
  });
}

function getExt({ extension, output }: Options) {
  if (extension) return extension;
  if (output && isSupported(output)) return path.extname(output);
  return 'ts';
}

async function processDirectory(dirPath: string, options: Options) {
  if (!fs.statSync(dirPath).isDirectory()) return processFiles([dirPath], options);
  const { output, recursive, dryRun } = options;
  const config = loadBaseConfig(options);
  ensureOutputDir(output, dryRun);
  const mode = dryRun ? OutputMode.DRY_RUN_DIR : OutputMode.NORMAL;
  let modified = 0;
  let created = 0;
  for await (const { relativePath, resolvedPath: inputFile } of getFiles(dirPath, !recursive)) {
    if (!isSupported(relativePath)) continue;
    const filePath = path.join(dirPath, relativePath);
    const allConfig = resolveConfigForFile(inputFile, config);
    if (isFileExcludedByConfig(inputFile, allConfig.config)) continue;
    const source = fs.readFileSync(inputFile).toString();
    const result = formatSource(inputFile, source, allConfig);
    const outputFile = output ? path.join(output, relativePath) : output;
    const { error, modified: m, created: c } = outputResult(
      mode,
      result,
      outputFile,
      source,
      filePath,
    );
    if (error) process.exit(1);
    if (m) modified += m;
    if (c) created += c;
  }
  summary(mode, modified, created);
}

function processFiles(filePaths: string[], options: Options) {
  const { output, dryRun } = options;
  const single = filePaths.length === 1;
  if (!single && output) {
    process.stderr.write(`Option output: should be empty if multiple files are provided.`);
    process.exit(1);
  }
  for (const f of filePaths) {
    if (fs.statSync(f).isFile()) continue;
    process.stderr.write(`Option: '${f}' is not a file.`);
    process.exit(1);
  }
  const config = loadBaseConfig(options);
  const mode = dryRun
    ? single
      ? OutputMode.DRY_RUN_FILE
      : OutputMode.DRY_RUN_FILES
    : OutputMode.NORMAL;
  let modified = 0;
  let created = 0;
  for (const filePath of filePaths) {
    if (!isSupported(filePath)) {
      process.stdout.write(`'${filePath}' is not a supported file type.\n`);
      continue;
    }
    const inputFile = path.resolve(filePath);
    const allConfig = resolveConfigForFile(inputFile, config);
    if (isFileExcludedByConfig(inputFile, allConfig.config)) {
      process.stdout.write(`'${filePath}' is excluded by config.\n`);
    } else {
      const source = fs.readFileSync(inputFile).toString();
      const result = formatSource(inputFile, source, allConfig);
      const outputFile =
        output && fs.existsSync(output) && fs.statSync(output).isDirectory()
          ? path.resolve(output, path.basename(inputFile))
          : output;
      const { error, modified: m, created: c } = outputResult(
        mode,
        result,
        outputFile,
        source,
        filePath,
      );
      if (error) process.exit(1);
      if (m) modified += m;
      if (c) created += c;
    }
  }
  summary(mode, modified, created);
}

function summary(mode: OutputMode, modified: number, created: number) {
  if (mode === OutputMode.DRY_RUN_FILE || mode === OutputMode.DRY_RUN_FILES) return;
  const tense = mode === OutputMode.NORMAL ? '' : 'will be ';
  if (modified || !created) process.stdout.write(sumResult(modified, tense + 'modified'));
  if (created) process.stdout.write(sumResult(created, tense + 'created'));
}

function sumResult(num: number, action: string) {
  return `${num === 0 ? 'No' : num} ${num === 1 ? 'file' : 'files'} ${action}.\n`;
}

export async function format(options: Options) {
  switch (options._.length) {
    case 0:
      processStdin(options);
      break;
    case 1:
      await processDirectory(options._[0], options);
      break;
    default:
      processFiles(options._, options);
  }
}
