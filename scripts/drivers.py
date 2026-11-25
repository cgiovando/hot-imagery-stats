"""Classify projects by driver: the hazard or crisis a project responds to.

Keyword rules over project metadata, multilingual (EN/ES/FR/PT/ID/TL and a
few others). Two tiers:

- primary: the driver appears in a campaign name or the project name.
  High precision.
- mentioned: the driver only appears in the short description (often as
  background risk, "one of the most cyclone-prone countries") or in a TM
  interest tag (project managers tick several, so tags are noisy). Lower
  relevance; shown only when the dashboard user opts in.

Manual corrections live in driver_overrides.json next to this file.
"""

import json
import re
from pathlib import Path

# Display order and labels (the dashboard reads labels from the data).
DRIVERS = {
    "flood": "Flood",
    "tropical_cyclone": "Tropical cyclone",
    "severe_storm": "Severe storm",
    "earthquake": "Earthquake",
    "landslide": "Landslide",
    "volcano": "Volcano",
    "tsunami": "Tsunami",
    "wildfire": "Wildfire",
    "drought": "Drought",
    "extreme_temperature": "Extreme temperature",
    "epidemic": "Epidemic / disease",
    "conflict": "Conflict",
    "displacement": "Displacement",
    "technological": "Technological / industrial",
}

_PATTERNS = {
    "flood": r"flood|inundat|inondation|inundaci|\bcrues?\b|enchente|alagamento|banjir|"
             r"dam (break|burst|spill|collapse|failure)|spillage|glof",
    "tropical_cyclone": r"cyclone|cyclonic|cicl[oó]n|ciclone|hurricane|hurac[aá]n|furac[aã]o|typhoon|"
                        r"tif[oó]n|tufão|tropical (storm|depression)|tormenta tropical|"
                        r"temp[eê]te tropicale|ouragan|bagyo|medicane|storm surge",
    "severe_storm": r"hail ?storm|granizo|gr[eê]le|tornado|windstorm|derecho|blizzard|"
                    r"snow ?storm|\bstorm\b(?! (surge|drain|water))|temporal\b|tempestade|"
                    r"\btormenta\b(?! tropical)",
    "earthquake": r"earthquake|quake|s[eé]isme|sismo|s[ií]smic|seismic|terremoto|"
                  r"tremblement de terre|gempa|lindol|deprem",
    "landslide": r"landslide|mudslide|mud ?flow|deslizamiento|deslizamento|deslave|"
                 r"glissement de terrain|huayco|huaico|longsor|debris flow|rock ?fall",
    "volcano": r"volcan|vulc[aã]o|vulkan|eruption|erupci|erup[cç][aã]o|lahar",
    "tsunami": r"tsunami",
    "wildfire": r"wild ?fires?|bush ?fires?|forest fires?|grass ?fires?|fires\b|incendi|"
                r"inc[eê]ndio|queimada|feux? de (for[eê]t|brousse)|kebakaran hutan",
    # El Niño/La Niña are left out: they bring floods in some regions and
    # drought in others.
    "drought": r"drought|sequ[ií]a|s[eé]cheresse|\bseca\b",
    "extreme_temperature": r"heat ?wave|extreme heat|canicule|ola de calor|onda de calor|"
                           r"cold ?wave|dzud|\bfrost\b|helada",
    "epidemic": r"ebola|cholera|c[oó]lera|chol[eé]ra|covid|coronavirus|sars-cov|malaria|"
                r"paludisme|paludismo|\bpolio|measles|sarampi[oó]n|sarampo|rougeole|dengue|"
                r"\bzika|mpox|monkeypox|yellow fever|fi[eè]vre jaune|fiebre amarilla|lassa|"
                r"meningitis|m[eé]ningite|marburg|\bplague\b|epidemi|[eé]pid[eé]mi|pandemi|"
                r"outbreak|\bbrote\b|neglected tropical|schistosomiasis|trachoma|"
                r"onchocerciasis|filariasis|\bntds?\b|\bhiv\b|pepfar|tuberculosis|"
                r"\bnoma\b|diphtheria|typhoid",
    "conflict": r"conflict|conflit|conflicto|conflito|armed|\bwar\b|\bguerras?\b|\bguerres?\b|"
                r"insurgen|militia|airstrike|bombing|ceasefire|"
                r"landmine|\buxo\b|explosive ordnance",
    "displacement": r"refugee|r[eé]fugi|refugiad|displace|d[eé]plac[eé]|desplazad|deslocad|"
                    r"\bidps?\b|rohingya|asylum|migrant|migraci[oó]n|returnee|"
                    r"settlement camp|refugee camp|\bcamp(s)? for\b",
    "technological": r"explosion|explosi[oó]n|explos[aã]o|\bblast\b|oil spill|"
                     r"derrame de (petr|crudo|hidrocarb)|chemical (spill|leak|accident)|"
                     r"industrial accident|nuclear|radiolog|gas leak|building collapse|"
                     r"mine (collapse|disaster)|tailings dam",
}
_RX = {k: re.compile(v, re.IGNORECASE) for k, v in _PATTERNS.items()}

# TM interest tags that point to a driver (mentioned tier only: noisy).
INTEREST_DRIVERS = {
    "conflict": "conflict",
    "refugee response": "displacement",
    "displacement & safe migration": "displacement",
}

# TM interest tags that give the disaster-management phase.
INTEREST_PHASES = {
    "disaster preparedness": "preparedness",
    "disaster response": "response",
    "disaster recovery": "recovery",
}

_TAG_RE = re.compile(r"<[^>]+>")


def match_text(text):
    """Return the set of driver keys whose pattern matches `text`."""
    if not text:
        return set()
    text = _TAG_RE.sub(" ", text)
    found = {k for k, rx in _RX.items() if rx.search(text)}
    # A tropical cyclone is not also a generic "severe storm".
    if "tropical_cyclone" in found:
        found.discard("severe_storm")
    return found


def ordered(keys):
    return [k for k in DRIVERS if k in keys]


_overrides = None


def load_overrides():
    """{uid: {"drivers": [...], "note": "..."}} manual corrections."""
    global _overrides
    if _overrides is None:
        path = Path(__file__).resolve().parent / "driver_overrides.json"
        try:
            with open(path) as f:
                data = json.load(f)
            _overrides = {k: v for k, v in data.items() if not k.startswith("_")}
        except (OSError, json.JSONDecodeError):
            _overrides = {}
    return _overrides


def classify_project(p):
    """Set drivers / driversMentioned / phase on a summary record in place.

    Uses: name, campaigns, interests (TM), and descDrivers (TM, computed from
    the short description when the project was fetched from R2).
    """
    primary = match_text(p.get("name"))
    for c in p.get("campaigns") or []:
        primary |= match_text(c)
    if "tropical_cyclone" in primary:
        primary.discard("severe_storm")

    mentioned = set(p.get("descDrivers") or [])
    for i in p.get("interests") or []:
        d = INTEREST_DRIVERS.get(i.lower())
        if d:
            mentioned.add(d)
    mentioned -= primary

    override = load_overrides().get(p.get("uid"))
    if override is not None:
        primary = set(override.get("drivers", []))
        mentioned = set(override.get("mentioned", [])) - primary

    p["drivers"] = ordered(primary)
    p["driversMentioned"] = ordered(mentioned)
    phases = {INTEREST_PHASES[i.lower()] for i in p.get("interests") or [] if i.lower() in INTEREST_PHASES}
    p["phase"] = [ph for ph in ("preparedness", "response", "recovery") if ph in phases]
