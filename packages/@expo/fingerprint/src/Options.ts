import fs from 'fs/promises';
import type { Minimatch } from 'minimatch';
import os from 'os';
import path from 'path';

import { loadConfigAsync } from './Config';
import { satisfyExpoVersion } from './ExpoResolver';
import type { Config, NormalizedOptions, Options, Platform } from './Fingerprint.types';
import { resolveProjectWorkflowAsync } from './ProjectWorkflow';
import { SourceSkips } from './sourcer/SourceSkips';
import { appendIgnorePath, buildDirMatchObjects, buildPathMatchObjects } from './utils/Path';

export const FINGERPRINT_IGNORE_FILENAME = '.fingerprintignore';

export const DEFAULT_IGNORE_PATHS = [
  FINGERPRINT_IGNORE_FILENAME,
  // Android
  '**/android/build/**/*',
  '**/android/.cxx/**/*',
  '**/android/.gradle/**/*',
  '**/android/app/build/**/*',
  '**/android/app/.cxx/**/*',
  '**/android/app/.gradle/**/*',
  '**/android-annotation/build/**/*',
  '**/android-annotation/.cxx/**/*',
  '**/android-annotation/.gradle/**/*',
  '**/android-annotation-processor/build/**/*',
  '**/android-annotation-processor/.cxx/**/*',
  '**/android-annotation-processor/.gradle/**/*',

  // Often has different line endings, thus we have to ignore it
  '**/android/gradlew.bat',

  // Android gradle plugins
  '**/*-gradle-plugin/build/**/*',
  '**/*-gradle-plugin/.cxx/**/*',
  '**/*-gradle-plugin/.gradle/**/*',

  // iOS
  '**/ios/Pods/**/*',
  '**/ios/build/**/*',
  '**/ios/.xcode.env.local',
  '**/ios/**/project.xcworkspace',
  '**/ios/*.xcworkspace/xcuserdata/**/*',

  // System files that differ from machine to machine
  '**/.DS_Store',

  // Ignore all expo configs because we will read expo config in a HashSourceContents already
  'app.config.ts',
  'app.config.js',
  'app.config.json',
  'app.json',

  // Ignore nested node_modules
  '**/node_modules/**/node_modules/**',

  // Ignore node binaries that might be platform dependent
  '**/node_modules/**/*.node',
  '**/node_modules/@img/sharp-*/**/*',
  '**/node_modules/sharp/{build,vendor}/**/*',
];

export const DEFAULT_SOURCE_SKIPS = SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun;

export async function normalizeOptionsAsync(
  projectRoot: string,
  options?: Options
): Promise<NormalizedOptions> {
  const config = await loadConfigAsync(projectRoot, options?.silent ?? false);
  const ignorePathMatchObjects = await collectIgnorePathsAsync(
    projectRoot,
    config?.ignorePaths,
    options
  );
  const useCNGForPlatforms = await resolveUseCNGAsync(projectRoot, options, ignorePathMatchObjects);
  if (useCNGForPlatforms.android) {
    appendIgnorePath(ignorePathMatchObjects, 'android/**/*');
  }
  if (useCNGForPlatforms.ios) {
    appendIgnorePath(ignorePathMatchObjects, 'ios/**/*');
  }
  return {
    // Defaults
    platforms: ['android', 'ios'],
    concurrentIoLimit: os.cpus().length,
    hashAlgorithm: 'sha1',
    sourceSkips: DEFAULT_SOURCE_SKIPS,
    // Options from config
    ...config,
    // Explicit options
    ...Object.fromEntries(Object.entries(options ?? {}).filter(([_, v]) => v != null)),
    // These options are computed by both default and explicit options, so we put them last.
    enableReactImportsPatcher:
      options?.enableReactImportsPatcher ??
      config?.enableReactImportsPatcher ??
      satisfyExpoVersion(projectRoot, '<52.0.0') ??
      false,
    ignorePathMatchObjects,
    ignoreDirMatchObjects: buildDirMatchObjects(ignorePathMatchObjects),
    useCNGForPlatforms,
  };
}

async function collectIgnorePathsAsync(
  projectRoot: string,
  pathsFromConfig: Config['ignorePaths'],
  options: Options | undefined
): Promise<Minimatch[]> {
  const ignorePaths = [
    ...DEFAULT_IGNORE_PATHS,
    ...(pathsFromConfig ?? []),
    ...(options?.ignorePaths ?? []),
    ...(options?.dirExcludes?.map((dirExclude) => `${dirExclude}/**/*`) ?? []),
  ];

  const fingerprintIgnorePath = path.join(projectRoot, FINGERPRINT_IGNORE_FILENAME);
  try {
    const fingerprintIgnore = await fs.readFile(fingerprintIgnorePath, 'utf8');
    const fingerprintIgnoreLines = fingerprintIgnore.split('\n');
    for (const line of fingerprintIgnoreLines) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        ignorePaths.push(trimmedLine);
      }
    }
  } catch {}

  return buildPathMatchObjects(ignorePaths);
}

async function resolveUseCNGAsync(
  projectRoot: string,
  options: Options | undefined,
  ignorePathMatchObjects: Minimatch[]
): Promise<Record<Platform, boolean>> {
  const results: Record<Platform, boolean> = {
    android: false,
    ios: false,
  };
  const platforms = options?.platforms ?? ['android', 'ios'];
  for (const platform of platforms) {
    const projectWorkflow = await resolveProjectWorkflowAsync(
      projectRoot,
      platform,
      ignorePathMatchObjects
    );
    results[platform] = projectWorkflow === 'managed';
  }
  return results;
}
