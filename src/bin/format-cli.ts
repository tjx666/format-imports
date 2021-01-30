#!/usr/bin/env node

import fs from 'fs-extra';
import path, { sep } from 'path';
import tmp from 'tmp';

import {
  formatSource,
  isFileExcludedByConfig,
  loadConfigFromJsonFile,
  resolveConfigForFile,
} from '../lib';
import { getFiles } from '../lib/common';
import {
  Options,
  processArgv,
  usage,
  version,
} from './options';

function loadBaseConfig({ config, force }: Options) {
  const cfg = config ? loadConfigFromJsonFile(config) : {};
  return { ...cfg, force };
}

enum OutputMode {
  NORMAL,
  DRY_RUN_SINGLE,
  DRY_RUN,
}
function dryRunOutput(
  source: string,
  result: string | undefined,
  mode: OutputMode,
  inputFile?: string,
) {
  if (mode === OutputMode.DRY_RUN) {
    if (result !== undefined) process.stdout.write(`'${inputFile}' will be modified.\n`);
    else process.stdout.write(`'${inputFile}' remains the same.\n`);
  } else if (mode === OutputMode.DRY_RUN_SINGLE) process.stdout.write(result ?? source);
}

function outputResult(
  source: string,
  result: string | undefined,
  outputFile: string | undefined,
  mode: OutputMode,
  inputFile?: string,
) {
  if (outputFile) {
    if (fs.existsSync(outputFile) && !fs.statSync(outputFile).isFile()) {
      process.stderr.write(`Option output: '${outputFile}' is not a file.\n`);
      return false;
    }
    if (mode === OutputMode.NORMAL) fs.outputFileSync(outputFile, result ?? source);
    else dryRunOutput(source, result, mode, inputFile);
  } else if (inputFile) {
    if (mode === OutputMode.NORMAL) {
      if (result !== undefined) fs.writeFileSync(inputFile, result);
    } else dryRunOutput(source, result, mode, inputFile);
  } else process.stdout.write(result ?? source);
  return true;
}

function ensureOutputDir(output: string | undefined, dryRun: boolean | undefined) {
  if (!output) return;
  if (!fs.existsSync(output)) {
    if (!dryRun) fs.mkdirSync(output, { recursive: true });
  } else if (!fs.statSync(output).isDirectory()) {
    process.stderr.write(`Option output: '${output}' is not directory.\n`);
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
    const ext = getExt(options);
    const { fd, name } = tmp.fileSync({ postfix: `.${ext}` });
    fs.writeSync(fd, source);
    const result = formatSource(name, source, { config });
    const mode = dryRun ? OutputMode.DRY_RUN_SINGLE : OutputMode.NORMAL;
    if (!outputResult(source, result, output, mode)) process.exit(1);
  });
}

// TODO: Move to lib?
function isSupported(filePath: string | undefined) {
  return !!filePath && /[^.\\\/]+\.(tsx?|jsx?)$/.test(filePath);
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
  const mode = dryRun ? OutputMode.DRY_RUN : OutputMode.NORMAL;
  for await (const { relativePath, resolvedPath: inputFile } of getFiles(dirPath, !recursive)) {
    if (!isSupported(relativePath)) continue;
    process.stdout.write(`[${relativePath}, ${inputFile}]\n`);

    const filePath = dirPath + sep + relativePath;
    const allConfig = resolveConfigForFile(inputFile, config);
    if (isFileExcludedByConfig(inputFile, allConfig.config)) {
      if (dryRun) process.stdout.write(`'${filePath}' is excluded by config.\n`);
      continue;
    }
    const source = fs.readFileSync(inputFile).toString();
    const result = formatSource(inputFile, source, allConfig);
    const outputFile = output ? output + sep + relativePath : output;
    if (!outputResult(source, result, outputFile, mode, filePath)) process.exit(1);
  }
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
      ? OutputMode.DRY_RUN_SINGLE
      : OutputMode.DRY_RUN
    : OutputMode.NORMAL;
  filePaths.forEach(filePath => {
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
      if (!outputResult(source, result, outputFile, mode, filePath)) process.exit(1);
    }
  });
}

async function main(argv: string[]) {
  const options = processArgv(argv);
  if (options.help) usage();
  if (options.version) version();
  try {
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : `${e}`;
    process.stderr.write(message + '\n');
    process.exit(1);
  }
}

main(process.argv);
