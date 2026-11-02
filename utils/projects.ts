import { getItem, setItem, getProjectItem, setProjectItem, deleteProjectItem, deleteItem } from './db';
import { listImageIds, deleteImage } from './imageStorage';

/**
 * Multi-project storage
 * ---------------------
 * - A registry (keyval store) lists all projects and the active one.
 * - Every project owns 8 entries in the `project` store (worldInfo, chapters, ...)
 *   plus one save game in the keyval store.
 * - The project that existed before multi-project support keeps its original
 *   un-prefixed keys under the id `main`, so nothing has to be migrated.
 * - Media (images, audio, video) lives in the shared `images` store. Which
 *   media belongs to which project is derived by scanning the project data
 *   for image ids (see collectMediaRefs).
 */

export const LEGACY_PROJECT_ID = 'main';
const REGISTRY_KEY = 'vn_projects_registry';

export const PROJECT_FIELDS = ['worldInfo', 'chapters', 'characters', 'scenes', 'battles', 'maps', 'assets', 'dungeons'] as const;
export type ProjectField = typeof PROJECT_FIELDS[number];

export interface ProjectEntry {
  id: string;
  title: string;
  coverImageId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectRegistry {
  activeId: string;
  projects: ProjectEntry[];
}

/** Shape used by the app: same as the export file (`dungeonProjects` instead of the `dungeons` key) */
export interface ProjectData {
  worldInfo?: any;
  chapters?: any[];
  characters?: any[];
  scenes?: any[];
  battles?: any[];
  maps?: any[];
  assets?: any[];
  dungeonProjects?: any[];
  [extra: string]: any;
}

export const projectKey = (id: string, field: ProjectField): string =>
  id === LEGACY_PROJECT_ID ? field : `p:${id}:${field}`;

export const saveGameKey = (id: string): string =>
  id === LEGACY_PROJECT_ID ? 'vn_creator_savegame' : `vn_creator_savegame:${id}`;

export const loadRegistry = async (): Promise<ProjectRegistry | null> => {
  const reg = await getItem<ProjectRegistry>(REGISTRY_KEY);
  if (!reg || !Array.isArray(reg.projects) || reg.projects.length === 0) return null;
  return reg;
};

export const saveRegistry = (reg: ProjectRegistry): Promise<void> => setItem(REGISTRY_KEY, reg);

export const createEntry = (id: string, title = ''): ProjectEntry => {
  const now = Date.now();
  return { id, title, coverImageId: null, createdAt: now, updatedAt: now };
};

export const loadProjectFields = async (id: string): Promise<ProjectData> => {
  const [worldInfo, chapters, characters, scenes, battles, maps, assets, dungeons] = await Promise.all(
    PROJECT_FIELDS.map(f => getProjectItem<any>(projectKey(id, f)))
  );
  const data: ProjectData = {};
  if (worldInfo) data.worldInfo = worldInfo;
  if (chapters) data.chapters = chapters;
  if (characters) data.characters = characters;
  if (scenes) data.scenes = scenes;
  if (battles) data.battles = battles;
  if (maps) data.maps = maps;
  if (assets) data.assets = assets;
  if (dungeons) data.dungeonProjects = dungeons;
  return data;
};

export const hasProjectData = (d: ProjectData): boolean =>
  !!(d.worldInfo || d.chapters || d.characters || d.scenes || d.assets);

export const saveProjectFields = async (id: string, data: ProjectData): Promise<void> => {
  const entries: [ProjectField, any][] = [
    ['worldInfo', data.worldInfo], ['chapters', data.chapters], ['characters', data.characters],
    ['scenes', data.scenes], ['battles', data.battles], ['maps', data.maps],
    ['assets', data.assets], ['dungeons', data.dungeonProjects],
  ];
  for (const [field, value] of entries) {
    if (field === 'worldInfo') {
      if (value) await setProjectItem(projectKey(id, field), value);
    } else {
      await setProjectItem(projectKey(id, field), value ?? []);
    }
  }
};

export const deleteProjectFields = async (id: string): Promise<void> => {
  for (const f of PROJECT_FIELDS) await deleteProjectItem(projectKey(id, f));
  await deleteItem(saveGameKey(id));
};

/** Collects every string value in `data` that is a known media id */
export const collectMediaRefs = (data: unknown, knownIds: Set<string>, into: Set<string> = new Set()): Set<string> => {
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (knownIds.has(v)) into.add(v);
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else if (v && typeof v === 'object') {
      for (const key in v as Record<string, unknown>) walk((v as Record<string, unknown>)[key]);
    }
  };
  walk(data);
  return into;
};

/** Media ids used by the given in-memory project data */
export const mediaRefsOf = async (data: ProjectData): Promise<Set<string>> => {
  const known = new Set(await listImageIds());
  return collectMediaRefs(data, known);
};

/**
 * Deletes the candidate media ids that no stored project references any more.
 * Always reads the *stored* data, so flush pending writes before calling.
 */
export const pruneUnusedMedia = async (candidates: Set<string>): Promise<number> => {
  if (candidates.size === 0) return 0;
  const reg = await loadRegistry();
  const stillUsed = new Set<string>();
  for (const p of reg?.projects ?? []) {
    collectMediaRefs(await loadProjectFields(p.id), candidates, stillUsed);
    if (stillUsed.size === candidates.size) return 0;
  }
  let removed = 0;
  for (const id of candidates) {
    if (!stillUsed.has(id)) { await deleteImage(id).catch(() => {}); removed++; }
  }
  return removed;
};
