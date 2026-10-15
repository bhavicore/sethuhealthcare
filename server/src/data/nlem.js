import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';

// Loads the National List of Essential Medicines (NLEM) 2022 into the medicines
// table. This is real reference data, not seeded invention: every row records
// the section it came from and how much of it we actually have.
//
// The list reached us in two qualities, and they are kept apart on purpose:
//   'full'      — name, levels of care (P/S/T) and dosage forms (Sections 1-7)
//   'name-only' — the medicine name and its section, nothing more (all sections)
// A name-only row never overwrites detail, and a medicine known only by name
// keeps null levels and forms rather than being given invented ones.
//
// NLEM publishes dosage forms, not maximum daily doses, so an imported medicine
// has no dose ceiling. checkDoseLimits in clinical/rules.js says so rather than
// letting the check pass silently.

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

// Spelling variants of one medicine across the supplied files.
const ALIASES = new Map([
  ['phenoxymethylpenicillin', 'phenoxymethyl-penicillin'],
  ['pralidoxime', 'pralidoxime-chloride'],
  ['irinotecan', 'irinotecan-hydrochloride-trihydrate'],
  ['tenofovir-alafenamide', 'tenofovir-alafenamide-fumarate'],
  ['oral-rehydration-salts', 'ors'],
]);

// Rows that are table artefacts rather than medicines.
const PLACEHOLDER = /^(other entries|see official|not applicable|-{1,})$/i;

/** 'Lignocaine + adrenaline' → 'lignocaine-adrenaline' */
export function slugify(name) {
  const base = name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ') // drop parenthetical synonyms
    .replace(/\+/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return ALIASES.get(base) || base;
}

/** The first strength in a dosage-form string, as a stock unit label. */
function unitLabelFrom(forms) {
  if (!forms) return 'as listed';
  const m = forms.match(/(tablet|capsule|injection|sachet|powder|oral liquid|suppository)[^;,]*/i);
  return m ? m[0].trim() : forms.split(/[;,]/)[0].trim();
}

function readDataFiles() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => /^nlem-2022.*\.json$/.test(f))
    .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')) }))
    // Detailed files first: a medicine then leads with its most precise section
    // ('2.1' rather than '2'), and name-only rows only add sections to it.
    .sort((a, b) => (a.detail === 'name-only' ? 1 : 0) - (b.detail === 'name-only' ? 1 : 0));
}

/**
 * One row per medicine. A medicine listed in several sections (neostigmine is
 * in 1.4 and 4.2) takes the union of its levels and keeps every section.
 * Detail wins over name-only, whichever file is read first.
 */
export function mergeRows(files) {
  const byId = new Map();
  const skipped = [];
  for (const file of files) {
    for (const row of file.medicines) {
      if (PLACEHOLDER.test(row.name.trim())) {
        skipped.push({ name: row.name, section: row.section, reason: 'table artefact, not a medicine' });
        continue;
      }
      const id = slugify(row.name);
      const levels = row.levels ? row.levels.split(',').map((l) => l.trim()) : [];
      const section = row.sectionNumber || row.section;
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, {
          id,
          name: row.name,
          levels,
          sections: [section],
          forms: row.forms ? [row.forms] : [],
          notes: row.note ? [`${section}: ${row.note}`] : [],
          kind: row.kind || 'medicine',
        });
        continue;
      }
      existing.levels = [...new Set([...existing.levels, ...levels])].sort();
      if (!existing.sections.includes(section)) existing.sections.push(section);
      if (row.forms && !existing.forms.includes(row.forms)) existing.forms.push(row.forms);
      if (row.note) existing.notes.push(`${section}: ${row.note}`);
      // A longer published name is the fuller one ('Pralidoxime chloride (2-PAM)').
      if (row.name.length > existing.name.length) existing.name = row.name;
      if (row.kind === 'supply') existing.kind = 'supply';
    }
  }
  return { merged: [...byId.values()], skipped };
}

/**
 * Upserts the list. Medicines the demo already stocks keep their curated unit
 * label and dose ceiling — those were set against what a PHC dispenses — and
 * gain their real NLEM sections, levels and forms.
 */
export function loadNlem({ quiet = false } = {}) {
  const files = readDataFiles();
  const { merged, skipped } = mergeRows(files);

  const existing = new Map(
    db.prepare('SELECT id, unit_label, max_daily_dose_mg FROM medicines').all().map((r) => [r.id, r])
  );

  const upsert = db.prepare(`
    INSERT INTO medicines (id, generic_name, unit_label, max_daily_dose_mg, nlem_code,
                           nlem_sections, care_levels, dosage_forms, kind, verify_note, source)
    VALUES (@id, @generic_name, @unit_label, @max_daily_dose_mg, @nlem_code,
            @nlem_sections, @care_levels, @dosage_forms, @kind, @verify_note, @source)
    ON CONFLICT(id) DO UPDATE SET
      generic_name  = excluded.generic_name,
      nlem_code     = excluded.nlem_code,
      nlem_sections = excluded.nlem_sections,
      care_levels   = excluded.care_levels,
      dosage_forms  = excluded.dosage_forms,
      kind          = excluded.kind,
      verify_note   = excluded.verify_note,
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
        care_levels: m.levels.length ? m.levels.join(',') : null,
        dosage_forms: m.forms.length ? m.forms.join(' | ') : null,
        kind: m.kind,
        verify_note: m.notes.length ? m.notes.join(' ') : null,
        source: files[0].source,
      });
    }
  });
  run();

  const stats = {
    files: files.length,
    unique: merged.length,
    added,
    detailed: merged.filter((m) => m.levels.length).length,
    nameOnly: merged.filter((m) => !m.levels.length).length,
    primaryCare: merged.filter((m) => m.levels.includes('P')).length,
    flagged: merged.filter((m) => m.notes.length).length,
    notPrescribable: merged.filter((m) => m.kind === 'supply').length,
    skipped,
    notLoaded: files.flatMap((f) => f.notLoaded || []),
  };
  if (!quiet) {
    console.log(
      `Loaded NLEM 2022: ${stats.unique} medicines (${stats.detailed} with levels of care, ` +
      `${stats.nameOnly} by name only; ${stats.primaryCare} listed for primary care; ` +
      `${stats.flagged} flagged for verification).`
    );
  }
  return stats;
}
