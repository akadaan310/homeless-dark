#!/usr/bin/env python3
"""Inspect PINNED Unity reference LFS pointers only, never fetch payloads or run code."""
import concurrent.futures,hashlib,json,re,urllib.parse,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/evidence/megacity'
def inspect(t,sha):
 url='https://raw.githubusercontent.com/Unity-Technologies/megacity-metro/'+sha+'/'+urllib.parse.quote(t['path'])
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'HOMELESS-source-inspection/1.0'}),timeout=20) as r:b=r.read(1025)
  if len(b)>1024:raise ValueError('Pointer response limit')
  match=re.fullmatch(rb'version https://git-lfs.github.com/spec/v1\noid sha256:([a-f0-9]{64})\nsize ([0-9]+)\n',b)
  if not match:return {'path':t['path'],'pointer':False}
  return {'path':t['path'],'pointer':True,'oid':'sha256:'+match[1].decode(),'lfs_size_bytes':int(match[2]),'pointer_sha256':hashlib.sha256(b).hexdigest()}
 except Exception as e:return {'path':t['path'],'error':str(e)}
def main():
 report=json.loads((OUT/'inspection.json').read_text());tree=json.loads((OUT/'tree.json').read_text())
 attrs=(OUT/'.gitattributes').read_text();extensions=set(re.findall(r'\*\.([A-Za-z0-9]+) filter=lfs',attrs))
 candidates=[t for t in tree['tree'] if t.get('type')=='blob' and 120<=t.get('size',0)<=180 and t['path'].startswith('Assets/') and t['path'].rsplit('.',1)[-1] in extensions]
 if len(candidates)>500:raise ValueError('Pointer job exceeds 500 requests')
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:results=list(ex.map(lambda t:inspect(t,report['commit']),candidates))
 pointers=[r for r in results if r.get('pointer')];errors=[r for r in results if 'error'in r]
 unique={r['oid']:r['lfs_size_bytes'] for r in pointers}
 inventory=dict(commit=report['commit'],candidate_count=len(candidates),pointer_count=len(pointers),errors=errors,pointers=pointers,full_tree_truncated=tree['truncated'],inventory_method='All Assets files matching pinned .gitattributes LFS extensions and 120..180 byte pointer sizes; payloads never fetched. Extended or nonstandard pointers outside this range are not counted.',payload_bytes_per_path=sum(r['lfs_size_bytes'] for r in pointers),unique_payload_bytes=sum(unique.values()),unique_object_count=len(unique),lfs_checkout_confirmed=False)
 (OUT/'lfs-inventory.json').write_text(json.dumps(inventory,indent=2)+'\n')
 report['lfs_pointer_inventory']='assets/evidence/megacity/lfs-inventory.json';report['lfs_inspected_pointer_count']=len(pointers);report['lfs_inspected_unique_payload_bytes']=sum(unique.values());report['lfs_inventory_errors']=len(errors)
 (OUT/'inspection.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:v for k,v in inventory.items() if k not in ['pointers']},indent=2))
if __name__=='__main__':main()
