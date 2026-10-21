"""Record exact source/client content bytes; large experimental models stay external."""
import hashlib,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
def main():
    target=ROOT/'assets/content/content.lock.json';rows=[]
    for folder in ('assets/content','unity/Assets/HOMELESS/Content'):
        for path in sorted((ROOT/folder).rglob('*')):
            if not path.is_file() or path==target or '__pycache__' in path.parts or path.suffix=='.pyc':continue
            rows.append({'path':str(path.relative_to(ROOT)),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    report={'schema':'dark.content-library/1','files':rows,'file_count':len(rows),'bytes':sum(r['bytes'] for r in rows),
      'scope':'exact source and client content inventory; NOT native quality acceptance',
      'external_experiment':'SILMA749MB model cache remains outside repository; pinned evidence/content/silma/sources.lock.json'}
    target.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'files':len(rows),'bytes':report['bytes']}))
if __name__=='__main__':main()
