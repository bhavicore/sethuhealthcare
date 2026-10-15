"""Extracts the NLEM 2022 medicine schedule from the gazette PDF.

Uses the table ruling lines rather than text layout: multi-line rows are
vertically centred in the PDF, so a layout-based read misassigns dosage forms
to the row above (cefixime's tablet strengths land on cefazolin).
"""
import json
import re
import sys

import pdfplumber

ITEM = re.compile(r"^\d+(\.\d+)*$")
LEVELS = re.compile(r"^[PST](\s*,\s*[PST])*$")
HEADER_WORDS = {"medicine", "level of healthcare", "dosage form(s) and strength(s)", "s.no", "sl.no"}


def clean(cell):
    return re.sub(r"\s+", " ", (cell or "").replace("\n", " ")).strip()


def forms_of(cell):
    """One form per line in the cell; the PDF wraps long forms, so rejoin them."""
    out = []
    for line in (cell or "").split("\n"):
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        starts_new = re.match(
            r"^(Tablet|Capsule|Injection|Powder for [Ii]njection|Oral liquid|Oral Liquid|Solution|"
            r"Suspension|Suppository|Pessary|Sachet|Granules|Ointment|Cream|Gel|Lotion|Drops|"
            r"Inhaler|Respirator solution|Rotacaps|Nasal spray|Eye drops|Ear drops|Patch|"
            r"Liquid|Spray|Syrup|Dry syrup|Powder|As licensed|Chewable tablet|Dispersible tablet|"
            r"Modified release|Enteric coated|Pre-filled|Vial|Ampoule|Unit|Infusion)",
            line,
        )
        if out and not starts_new:
            out[-1] += " " + line
        else:
            out.append(line)
    return out


def extract(path):
    rows, sections, current_section = [], {}, None
    with pdfplumber.open(path) as pdf:
        for pageno, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            for line in text.split("\n"):
                m = re.match(r"^Section\s+(\d+(?:\.\d+)*)\s*[-–:]?\s*(.*)$", line.strip())
                if m and len(m.group(2)) < 80:
                    current_section = m.group(1)
                    title = m.group(2).strip(" -–")
                    if title and current_section not in sections:
                        sections[current_section] = title
            for table in page.extract_tables():
                for raw in table:
                    cells = [clean(c) for c in raw]
                    if len(cells) < 3:
                        continue
                    num, name = cells[0], cells[1]
                    if not ITEM.match(num) or not name:
                        continue
                    if name.lower() in HEADER_WORDS:
                        continue
                    # The gazette prints the schedule twice, in Hindi and in
                    # English. Keep the English table.
                    latin = len(re.findall(r"[A-Za-z]", name))
                    deva = len(re.findall(r"[\u0900-\u097F]", name))
                    if latin < 3 or deva > latin:
                        continue
                    level = cells[2] if len(cells) > 2 else ""
                    form_cell = raw[3] if len(raw) > 3 else ""
                    rows.append(
                        {
                            "item": num,
                            "section": num.split(".")[0],
                            "subsection": ".".join(num.split(".")[:-1]),
                            "name": name.rstrip("*").strip(),
                            "levels": level if LEVELS.match(level.replace(" ", "")) else None,
                            "levels_raw": level,
                            "forms": forms_of(form_cell),
                            "page": pageno,
                        }
                    )
    return rows, sections


if __name__ == "__main__":
    rows, sections = extract(sys.argv[1])
    json.dump({"rows": rows, "sections": sections}, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
    print(f"extracted {len(rows)} rows across {len(set(r['section'] for r in rows))} sections")
    missing = [r for r in rows if not r["levels"]]
    print(f"rows without a parsed level: {len(missing)}")
    for r in missing[:8]:
        print("   ", r["item"], r["name"], "| levels_raw:", repr(r["levels_raw"])[:40])
