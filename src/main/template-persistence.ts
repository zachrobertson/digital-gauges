import { app } from 'electron';
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GaugeTemplateFile, GaugeTemplateSummary } from '../shared/types/gaugeTemplate';

function templatesDir(): string {
  return join(app.getPath('documents'), 'DigitalGauges', 'templates');
}

async function ensureTemplatesDir(): Promise<string> {
  const dir = templatesDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function templateFilePath(id: string): string {
  return join(templatesDir(), `${id}.dgtemplate.json`);
}

function normalizeTemplate(raw: unknown): GaugeTemplateFile {
  const t = raw as GaugeTemplateFile;
  const now = new Date().toISOString();
  return {
    version: 1,
    id: t.id ?? crypto.randomUUID(),
    name: t.name ?? 'Untitled template',
    type: t.type === 'layout' ? 'layout' : 'single',
    createdAt: t.createdAt ?? now,
    updatedAt: t.updatedAt ?? now,
    gauge: t.gauge,
    gauges: t.gauges,
  };
}

export async function listTemplates(): Promise<GaugeTemplateSummary[]> {
  const dir = await ensureTemplatesDir();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out: GaugeTemplateSummary[] = [];
  for (const file of files) {
    if (!file.endsWith('.dgtemplate.json')) continue;
    try {
      const raw = await readFile(join(dir, file), 'utf8');
      const t = normalizeTemplate(JSON.parse(raw));
      out.push({
        id: t.id,
        name: t.name,
        type: t.type,
        updatedAt: t.updatedAt,
        filePath: join(dir, file),
      });
    } catch {
      /* skip corrupt template */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveTemplate(template: GaugeTemplateFile): Promise<GaugeTemplateFile> {
  await ensureTemplatesDir();
  const normalized = normalizeTemplate({
    ...template,
    updatedAt: new Date().toISOString(),
  });
  await writeFile(templateFilePath(normalized.id), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

export async function loadTemplate(id: string): Promise<GaugeTemplateFile | null> {
  const path = templateFilePath(id);
  try {
    await access(path);
  } catch {
    return null;
  }
  const raw = await readFile(path, 'utf8');
  return normalizeTemplate(JSON.parse(raw));
}

export async function deleteTemplate(id: string): Promise<void> {
  const path = templateFilePath(id);
  try {
    await unlink(path);
  } catch {
    /* already gone */
  }
}

export async function importTemplateFromPath(sourcePath: string): Promise<GaugeTemplateFile> {
  const raw = await readFile(sourcePath, 'utf8');
  const parsed = normalizeTemplate(JSON.parse(raw));
  const imported: GaugeTemplateFile = {
    ...parsed,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return saveTemplate(imported);
}

export async function exportTemplateToPath(id: string, destPath: string): Promise<void> {
  const template = await loadTemplate(id);
  if (!template) throw new Error('Template not found');
  await writeFile(destPath, JSON.stringify(template, null, 2), 'utf8');
}
