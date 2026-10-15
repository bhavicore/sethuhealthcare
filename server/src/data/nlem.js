import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';

// Loads the National List of Essential Medicines (NLEM) 2022 into the medicines
// table. This is real reference data, not seeded invention: every row carries
// the section it came from, the levels of care it is listed for (P/S/T), and
// the dosage forms as published.
//
// What NLEM does NOT give us is a maximum daily dose, so an imported medicine
// has no dose ceiling. The rules engine says so rather than passing silently —
// see checkDoseLimits in clinical/rules.js.

const DATA_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/nlem-2022.json'
);

/** 'Lignocaine + adrenaline' → 'lignocaine-adrenaline' */
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')        // drop parenthetical synonyms
    .replace(/\+/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The first strength in a dosage-form string, as a stock unit label. */
function unitLabelFrom(forms) {
  const m = forms.match(/(tablet|capsule|injection|sachet|powder|oral liquid|suppository)[^;,]*/i);
  return m ? m[0].trim() : forms.split(/[;,]/)[0].trim();
}

/**
 * Merges the published rows into one row per medicine: a medicine listed in
 * several sections (neostigmine is in 1.4 and 4.2) takes the union of its
 * levels and keeps every section it appears under.
 */
export function mergeRows(rows) {
  const byId = new Map();
  for (const row of rows) {
    const id = slugify(row.name);
    const levels = row.levels.split(',').map((l) => l.trim());
    const existing = byId.get(id);
    if (existing) {
      existing.levels = [...new Set([...existing.levels, ...levels])].sort();
      existing.sections.push(row.section);
      if (!existing.forms.includes(row.forms)) existing.forms.push(row.forms);
    } else {
      byId.set(id, { id, name: row.name, levels, sections: [row.section], forms: [row.forms] });
    }
  }
  return [...byId.values()];
}

/**
 * Upserts the list. Medicines the demo already stocks keep their curated
 * unit label and dose ceiling — those were set against what a PHC actually
 * dispenses — and gain their real NLEM section, levels and forms.
 */
export function loadNlem({ quiet = false } = {}) {
  const file = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const merged = mergeRows(file.medicines);

  const existing = new Map(
    db.prepare('SELECT id, unit_label, max_daily_dose_mg FROM medicines').all().map((r) => [r.id, r])
  );

  const upsert = db.prepare(`
    INSERT INTO medicines (id, generic_name, unit_label, max_daily_dose_mg, nlem_code,
                           nlem_sections, care_levels, dosage_forms, source)
    VALUES (@id, @generic_name, @unit_label, @max_daily_dose_mg, @nlem_code,
            @nlem_sections, @care_levels, @dosage_forms, @source)
    ON CONFLICT(id) DO UPDATE SET
      nlem_code     = excluded.nlem_code,
      nlem_sections = excluded.nlem_sections,
      care_levels   = excluded.care_levels,
      dosage_forms  = excluded.dosage_forms,
      source        = excluded.source
  `);

  let added = 0;
  const run = db.transaction(() => {
    for (const m of merged) {
      const prior = existing.get(m.id);
      if (!prior) added++;
      upsert.run({
        id: m.id,
        generic_name: m.name,
        unit_label: prior?.unit_label ?? unitLabelFrom(m.forms[0]),
        max_daily_dose_mg: prior?.max_daily_dose_mg ?? null,
        nlem_code: m.sections[0],
        nlem_sections: m.sections.join(', '),
        care_levels: m.levels.join(','),
        dosage_forms: m.forms.join(' | '),
        source: file.source,
      });
    }
  });
  run();

  const stats = {
    published: file.medicines.length,
    unique: merged.length,
    added,
    updated: merged.length - added,
    primaryCare: merged.filter((m) => m.levels.includes('P')).length,
    coverage: file.coverage,
  };
  if (!quiet) {
    console.log(
      `Loaded NLEM 2022 reference list: ${stats.unique} medicines from ${stats.published} published ` +
      `entries (${stats.primaryCare} listed for primary care). ${stats.coverage}`
    );
  }
  return stats;
}
