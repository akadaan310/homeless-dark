from pathlib import Path
import hashlib,json,sys,time,tracemalloc,statistics
root=Path(__file__).resolve().parent
repo=Path(sys.argv[1]).resolve();sys.path.insert(0,str(repo/'packages'))
from dark_server.staging import Staging,bootstrap_manifest,scope,compare_allocations
manifest=bootstrap_manifest(repo);measurements=[]
for run in range(5):
 registry=Staging.create(repo,manifest)
 observation={'assets':[a['id'] for a in manifest['assets']],'path':[[0,0,0],[7,0,0]],'path_revision':1,'mode':'walk','speed_mps':1.4,'speed_confidence':.8,'wait_ticks':2,'observed_tick':0,'anticipated_tick':None,'visible':True,'ttl_ticks':100}
 tracemalloc.start();started=time.perf_counter_ns();cpu_started=time.process_time_ns()
 for index,operation in enumerate(['OBSERVE','PREDICT','ADMIT','STAGE','VERIFY','DECODE']):
  request={'request_id':str(index),'expected_revision':registry.revision,'cell_id':'hero-audio','operation':operation,'arguments':observation if operation=='OBSERVE' else {}}
  registry.apply('operator',[scope('hero-audio','prepare')],request,0)
 current,peak=tracemalloc.get_traced_memory();tracemalloc.stop()
 measurements.append({'wall_elapsed_ns':time.perf_counter_ns()-started,'process_cpu_ns':time.process_time_ns()-cpu_started,'python_tracemalloc_peak_bytes':peak,'actual_bytes_read':registry.snapshot()['metrics']['actual_bytes_read']})
summary={key:{'min':min(m[key] for m in measurements),'median':statistics.median(m[key] for m in measurements),'max':max(m[key] for m in measurements)} for key in measurements[0]}
result={'schema':'dark.staging-local-probe/1','scope':'Six actual known local art/audio files through portable DECODE; no collision resource, activation/native rendering not claimed','manifest':manifest,'total_manifest_bytes':sum(a['bytes'] for a in manifest['assets']),'candidate':registry.snapshot(),'measurements':measurements,'distribution':summary,'native_memory':'NOT_MEASURED','gpu_memory':'NOT_MEASURED','physical_validation':'NOT_RUN','allocation_counterexample':compare_allocations([{'id':'a','bytes':3,'benefit':5,'required':False},{'id':'b','bytes':2,'benefit':3,'required':False},{'id':'c','bytes':2,'benefit':3,'required':False}],4),'code_sha256':hashlib.sha256((repo/'packages/dark_server/staging.py').read_bytes()).hexdigest()}
(repo/'evidence/staging/probe.json').write_text(json.dumps(result,indent=2)+'\n');(repo/'evidence/staging/bootstrap-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'total_manifest_bytes':result['total_manifest_bytes'],'distribution':summary},indent=2))
