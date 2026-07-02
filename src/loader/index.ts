import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  FeatureIdSchema,
  PackMetadataSchema,
  PackSchema,
  QuestSchema,
  UnlockEdgeSchema,
  type FeatureId,
  type Level,
  type Pack,
  type PackMetadata,
  type Quest,
  type QuestId,
  type UnlockEdge,
} from "../core";

const metadataFileNames = ["pack.yml", "pack.yaml", "pack.json"] as const;

export type PackFormat = "yaml" | "json";

export interface PackDiscovery {
  readonly path: string;
  readonly metadataPath: string;
  readonly format: PackFormat;
}

export interface LoadPackOptions {
  readonly knownFeatureIds?: readonly string[];
}

export interface QuestPrereqEdge {
  readonly from: QuestId;
  readonly to: QuestId;
}

export interface QuestGraph {
  readonly pack: PackMetadata;
  readonly levels: readonly Level[];
  readonly quests: readonly Quest[];
  readonly questNodes: Readonly<Record<string, Quest>>;
  readonly levelNodes: Readonly<Record<string, Level>>;
  readonly prereqEdges: readonly QuestPrereqEdge[];
  readonly unlockEdges: readonly UnlockEdge[];
  readonly knownFeatureIds: readonly FeatureId[];
}

export async function discoverPacks(directories: readonly string[]): Promise<PackDiscovery[]> {
  const discoveries: PackDiscovery[] = [];
  const seen = new Set<string>();

  for (const directory of directories) {
    const root = resolve(directory);
    const rootStat = await stat(root).catch(() => undefined);
    if (!rootStat?.isDirectory()) {
      throw new Error(`Configured pack directory does not exist: ${root}`);
    }

    const rootMetadata = await maybeFindMetadataFile(root);
    if (rootMetadata !== undefined) {
      addDiscovery(discoveries, seen, root, rootMetadata);
    }

    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const child = join(root, entry.name);
      const childMetadata = await maybeFindMetadataFile(child);
      if (childMetadata !== undefined) {
        addDiscovery(discoveries, seen, child, childMetadata);
      }
    }
  }

  return discoveries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function loadPacks(directories: readonly string[], options: LoadPackOptions = {}): Promise<QuestGraph[]> {
  const discoveries = await discoverPacks(directories);
  const graphs: QuestGraph[] = [];

  for (const discovery of discoveries) {
    graphs.push(await loadPack(discovery.path, options));
  }

  return graphs.sort((left, right) => `${left.pack.id}`.localeCompare(`${right.pack.id}`));
}

export async function loadPack(packDirectory: string, options: LoadPackOptions = {}): Promise<QuestGraph> {
  const packDir = resolve(packDirectory);
  const metadataFile = await findMetadataFile(packDir);
  const metadata = await parsePackMetadata(packDir, metadataFile);
  const questFiles = await findQuestFiles(packDir);

  if (questFiles.length === 0) {
    throw new Error(`Pack "${metadata.id}" has no quest markdown files in ${packDir}`);
  }

  const quests: Quest[] = [];
  const questFilesById = new Map<string, string>();
  for (const questFile of questFiles) {
    let questInput: unknown;
    try {
      questInput = await parseQuestMarkdown(questFile);
    } catch (error) {
      throw new Error(`Pack "${metadata.id}" quest file ${relative(packDir, questFile)} failed parsing: ${errorMessage(error)}`);
    }
    const result = QuestSchema.safeParse(questInput);
    if (!result.success) {
      throw new Error(
        `Pack "${metadata.id}" quest file ${relative(packDir, questFile)} failed schema validation: ${formatZodIssues(
          result.error.issues,
        )}`,
      );
    }

    quests.push(result.data);
    questFilesById.set(`${result.data.id}`, relative(packDir, questFile));
  }

  const packResult = PackSchema.safeParse({ ...metadata, quests });
  if (!packResult.success) {
    throw new Error(`Pack "${metadata.id}" failed schema validation: ${formatZodIssues(packResult.error.issues)}`);
  }

  try {
    return buildQuestGraph(packResult.data, options);
  } catch (error) {
    const message = errorMessage(error);
    const questMatch = message.match(/quest "([^"]+)"/);
    const questFile = questMatch?.[1] === undefined ? undefined : questFilesById.get(questMatch[1]);
    const location = questFile === undefined ? "" : ` (${questFile})`;
    throw new Error(`Pack "${metadata.id}"${location}: ${message}`);
  }
}

export function buildQuestGraph(packInput: Pack, options: LoadPackOptions = {}): QuestGraph {
  const pack = PackSchema.parse(packInput);
  const optionFeatureIds = FeatureIdSchema.array().parse([...(options.knownFeatureIds ?? [])]);
  const levelsById = new Map<string, Level>();
  const questsById = new Map<string, Quest>();

  for (const level of pack.levels) {
    const id = `${level.id}`;
    if (levelsById.has(id)) {
      throw new Error(`duplicate level id "${id}"`);
    }
    levelsById.set(id, level);
  }

  for (const quest of pack.quests) {
    const id = `${quest.id}`;
    if (questsById.has(id)) {
      throw new Error(`duplicate quest id "${id}"`);
    }
    if (!levelsById.has(`${quest.level}`)) {
      throw new Error(`quest "${quest.id}" references unknown level "${quest.level}"`);
    }
    questsById.set(id, quest);
  }

  for (const level of pack.levels) {
    for (const questId of level.quests) {
      const quest = questsById.get(`${questId}`);
      if (quest === undefined) {
        throw new Error(`level "${level.id}" references unknown quest "${questId}"`);
      }
      if (`${quest.level}` !== `${level.id}`) {
        throw new Error(`level "${level.id}" lists quest "${questId}" assigned to level "${quest.level}"`);
      }
    }
  }

  const declaredFeatures = new Set<string>(optionFeatureIds.map((featureId) => `${featureId}`));
  for (const level of pack.levels) {
    for (const featureId of level.unlocks) {
      declaredFeatures.add(`${featureId}`);
    }
  }

  const prereqEdges: QuestPrereqEdge[] = [];
  const unlockEdges: UnlockEdge[] = [];

  for (const quest of pack.quests) {
    for (const prereq of quest.prereqs) {
      if (!questsById.has(`${prereq}`)) {
        throw new Error(`quest "${quest.id}" references unknown prereq "${prereq}"`);
      }
      prereqEdges.push({ from: prereq, to: quest.id });
    }

    for (const feature of quest.unlocks) {
      if (!declaredFeatures.has(`${feature}`)) {
        throw new Error(`quest "${quest.id}" references unknown unlock feature "${feature}"`);
      }
      unlockEdges.push(UnlockEdgeSchema.parse({ quest: quest.id, feature }));
    }
  }

  const cycle = findQuestCycle(pack.quests);
  if (cycle !== undefined) {
    throw new Error(`cyclic quest prereqs: ${cycle.join(" -> ")}`);
  }

  const levels = pack.levels
    .map((level) => ({
      ...level,
      quests: sortedUnique([
        ...level.quests.map((questId) => `${questId}`),
        ...pack.quests.filter((quest) => `${quest.level}` === `${level.id}`).map((quest) => `${quest.id}`),
      ]) as QuestId[],
      unlocks: sortedUnique(level.unlocks.map((featureId) => `${featureId}`)) as FeatureId[],
    }))
    .sort((left, right) => left.order - right.order || `${left.id}`.localeCompare(`${right.id}`));
  const quests = [...pack.quests].sort((left, right) => `${left.id}`.localeCompare(`${right.id}`));
  const knownFeatureIds = sortedUnique([...declaredFeatures]) as FeatureId[];
  const { quests: _quests, ...packMetadata } = pack;

  return {
    pack: {
      ...packMetadata,
      levels,
    },
    levels,
    quests,
    questNodes: Object.fromEntries(quests.map((quest) => [`${quest.id}`, quest])),
    levelNodes: Object.fromEntries(levels.map((level) => [`${level.id}`, level])),
    prereqEdges: prereqEdges.sort(comparePrereqEdges),
    unlockEdges: unlockEdges.sort(compareUnlockEdges),
    knownFeatureIds,
  };
}

export function toGraphJSON(graph: QuestGraph): string {
  const value = {
    edges: {
      prereqs: graph.prereqEdges,
      unlocks: graph.unlockEdges,
    },
    knownFeatureIds: graph.knownFeatureIds,
    levels: graph.levels,
    pack: graph.pack,
    quests: graph.quests,
  };

  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

async function parsePackMetadata(packDir: string, metadataFile: PackDiscovery): Promise<PackMetadata> {
  let input: unknown;
  try {
    input = await parseDataFile(metadataFile.metadataPath, metadataFile.format);
  } catch (error) {
    throw new Error(`Pack at ${packDir} metadata ${relative(packDir, metadataFile.metadataPath)} failed parsing: ${errorMessage(error)}`);
  }
  const result = PackMetadataSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Pack metadata ${relative(packDir, metadataFile.metadataPath)} failed schema validation: ${formatZodIssues(
        result.error.issues,
      )}`,
    );
  }
  return result.data;
}

async function parseDataFile(path: string, format: PackFormat): Promise<unknown> {
  const content = await readFile(path, "utf8");
  try {
    return format === "json" ? JSON.parse(content) : parseYaml(content);
  } catch (error) {
    throw new Error(`${path} parse failed: ${errorMessage(error)}`);
  }
}

async function parseQuestMarkdown(path: string): Promise<unknown> {
  const content = await readFile(path, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (match === null) {
    throw new Error(`Quest file ${path} is missing YAML frontmatter`);
  }

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(match[1] ?? "");
  } catch (error) {
    throw new Error(`Quest file ${path} frontmatter parse failed: ${errorMessage(error)}`);
  }

  if (!isRecord(frontmatter)) {
    throw new Error(`Quest file ${path} frontmatter must be a YAML object`);
  }

  return {
    ...frontmatter,
    description: (match[2] ?? "").trim(),
  };
}

async function findQuestFiles(packDir: string): Promise<string[]> {
  const files: string[] = [];
  await walkMarkdownFiles(packDir, files);
  return files.sort((left, right) => relative(packDir, left).localeCompare(relative(packDir, right)));
}

async function walkMarkdownFiles(directory: string, files: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdownFiles(path, files);
      continue;
    }

    if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      files.push(path);
    }
  }
}

async function findMetadataFile(packDir: string): Promise<PackDiscovery> {
  const metadata = await maybeFindMetadataFile(packDir);
  if (metadata === undefined) {
    throw new Error(`Pack at ${packDir} is missing pack.yml, pack.yaml, or pack.json`);
  }
  return metadata;
}

async function maybeFindMetadataFile(packDir: string): Promise<PackDiscovery | undefined> {
  const matches: PackDiscovery[] = [];
  for (const fileName of metadataFileNames) {
    const metadataPath = join(packDir, fileName);
    const fileStat = await stat(metadataPath).catch(() => undefined);
    if (fileStat?.isFile()) {
      matches.push({ path: packDir, metadataPath, format: fileName.endsWith(".json") ? "json" : "yaml" });
    }
  }

  if (matches.length > 1) {
    throw new Error(`Pack at ${packDir} has multiple metadata files: ${matches.map((match) => match.metadataPath).join(", ")}`);
  }

  return matches[0];
}

function addDiscovery(
  discoveries: PackDiscovery[],
  seen: Set<string>,
  packDir: string,
  metadata: PackDiscovery,
): void {
  if (seen.has(packDir)) {
    return;
  }
  seen.add(packDir);
  discoveries.push(metadata);
}

function findQuestCycle(quests: readonly Quest[]): string[] | undefined {
  const byId = new Map(quests.map((quest) => [`${quest.id}`, quest]));
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];

  const visit = (questId: string): string[] | undefined => {
    state.set(questId, "visiting");
    stack.push(questId);

    const quest = byId.get(questId);
    for (const prereq of quest?.prereqs ?? []) {
      const prereqId = `${prereq}`;
      if (state.get(prereqId) === "visiting") {
        const start = stack.indexOf(prereqId);
        return [...stack.slice(start), prereqId];
      }
      if (state.get(prereqId) === undefined) {
        const cycle = visit(prereqId);
        if (cycle !== undefined) {
          return cycle;
        }
      }
    }

    stack.pop();
    state.set(questId, "visited");
    return undefined;
  };

  for (const questId of [...byId.keys()].sort()) {
    if (state.get(questId) === undefined) {
      const cycle = visit(questId);
      if (cycle !== undefined) {
        return cycle;
      }
    }
  }

  return undefined;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }

  return value;
}

function comparePrereqEdges(left: QuestPrereqEdge, right: QuestPrereqEdge): number {
  return `${left.from}`.localeCompare(`${right.from}`) || `${left.to}`.localeCompare(`${right.to}`);
}

function compareUnlockEdges(left: UnlockEdge, right: UnlockEdge): number {
  return `${left.quest}`.localeCompare(`${right.quest}`) || `${left.feature}`.localeCompare(`${right.feature}`);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function formatZodIssues(
  issues: readonly { readonly path: readonly (string | number | symbol)[]; readonly message: string }[],
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "<root>" : issue.path.map((part) => String(part)).join(".");
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : `${error}`;
}
