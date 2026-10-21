#!/usr/bin/env python3
"""Derived source projection only. Never rewrites the governing constitution."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'HOMELESS_DARK_STANDALONE_CONSTITUTION.md'
LEDGER = ROOT / 'evidence/requirements.json'
PATTERN = re.compile(r'^## (\d{2,3})\. ([^\n]+)|^### §(\d+)\.([A-Za-z0-9]+) ([^\n]+)|^\*\*(HD-\d{3}(?:\.[A-Z]+)?) [^\n]+', re.M)

def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def extract(text):
    matches = list(PATTERN.finditer(text))
    explicit_ids = {m.group(6) for m in matches if m.group(6)}
    result = []
    for i, match in enumerate(matches):
        if match.group(1):
            clause = f'HD-{int(match.group(1)):03d}'
            # An explicit normative clause supersedes its organizational heading.
            if clause in explicit_ids:
                continue
        elif match.group(3):
            clause = f'HD-{int(match.group(3)):03d}.{match.group(4)}'
        else:
            clause = match.group(6)
        excerpt = text[match.start():matches[i+1].start() if i+1 < len(matches) else len(text)]
        result.append({'id': clause, 'source_line': text[:match.start()].count('\n')+1,
                       'text': excerpt, 'text_sha256': digest(excerpt)})
    if len({r['id'] for r in result}) != len(result):
        raise ValueError('Duplicate stable clause IDs')
    return result

def owner(clause):
    number = int(clause[3:6])
    if number in range(16,28) or number in (88,89): return 'geography-population'
    if number in range(33,55) or number in (7,47,48,49,85,92,94): return 'visual-audio'
    if number in range(55,69) or number in (87,91): return 'mathematics'
    if number in (8,70,76,77,78,79,80,81,82,95): return 'runtime-delivery'
    if number in (12,28,29,30,31,32,93): return 'living-world'
    return 'integration'

def project(text):
    rows = extract(text)
    for row in rows:
        row.update(owner=owner(row['id']), source_clause=row['id'], implementation=[],
                   test_scenario=[], observed_result='NOT_RUN', command_or_procedure='Implement and execute the complete source clause; inspect native evidence where required.',
                   build_commit=None, evidence=[], reviewer=None, verified_subsets=[],
                   unresolved_limitations=['Full clause acceptance has not been demonstrated.'])
    return {'schema':'homeless.requirements/1','source':SOURCE.name,'source_sha256':digest(text),
            'release_accepted':False,'requirements':rows}

def verify(text, projection):
    if projection.get('source_sha256') != digest(text): raise ValueError('Constitution digest mismatch')
    expected = extract(text)
    actual = projection.get('requirements',[])
    if [r['id'] for r in actual] != [r['id'] for r in expected]: raise ValueError('Missing/reordered clause')
    for left, right in zip(expected, actual):
        for key in ('text','text_sha256','source_line'):
            if left[key] != right.get(key): raise ValueError('Modified source projection: '+left['id'])
        if right.get('observed_result') not in {'PASS','FAIL','BLOCKED','NOT_RUN','NOT_APPLICABLE'}:
            raise ValueError('Invalid result vocabulary')
        if right['observed_result'] == 'PASS' and not right.get('evidence'):
            raise ValueError('PASS requires executed evidence')
    if projection.get('release_accepted') and any(r['observed_result'] not in {'PASS','NOT_APPLICABLE'} for r in actual):
        raise ValueError('Cannot accept release with unresolved clauses')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=('generate','verify'))
    parser.add_argument('--output',type=Path,default=LEDGER)
    args=parser.parse_args();text=SOURCE.read_text(encoding='utf-8')
    if args.command=='generate':
        if args.output.exists(): raise SystemExit('Refusing to overwrite the evidence ledger; choose a new output or update evidence deliberately.')
        projection=project(text);args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(projection,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    else:
        projection=json.loads(args.output.read_text(encoding='utf-8'));verify(text,projection)
    print(json.dumps({'status':'PASS','checks':'source projection integrity only','requirements':len(projection['requirements']),'source_sha256':digest(text),'release_accepted':projection['release_accepted']}))

if __name__=='__main__': main()
