from pathlib import Path
import hashlib,json,sys,tempfile
repo=Path(sys.argv[1]).resolve();sys.path[:0]=[str(repo/'packages'),str(repo/'tests/server')]
from dark_server.world import World,Refused
from test_world import content
with tempfile.TemporaryDirectory() as d:
 root=Path(d);asset=root/'volume.json';asset.write_text(json.dumps({'schema':'dark.collision-aabb/1','min':[-2,-1,-2],'max':[2,2,2],'spawn':[0,0,0]}))
 c=content();c['streaming']={'manifest':{'schema':'dark.stage-manifest/1','version':'test-v1','assets':[{'id':'volume','path':'volume.json','bytes':asset.stat().st_size,'sha256':hashlib.sha256(asset.read_bytes()).hexdigest(),'kind':'collision','decoder':'collision_aabb'}]},'cells':{'cafe-cell':{'node':'cafe','assets':['volume'],'portable_collision':True}}}
 w=World.create(root/'world.db',c,resource_root=root);token=w.register('reviewer');w.join(token,'join');serial=0
 def action(operation,args):
  global serial
  serial+=1
  return w.execute(token,{'schema':'dark.action/1','request_id':'review'+str(serial),'expected_revision':w.snapshot()['revision'],'operation':operation,'arguments':args})
 before=w.head()
 try:action('manual_move',{'east':10**1000,'north':0});print('NUMERIC_UNEXPECTED_PASS')
 except Exception as exc:print('HUGE_INTEGER',type(exc).__name__,str(exc),'head_unchanged',w.head()==before)
 action('prepare_cell',{'cell':'cafe-cell'});action('travel',{'destination':'harbor','mode':'walk'});w.advance(2000,'arrive-away')
 before=w.head()
 try:action('cancel_cell',{'cell':'cafe-cell'});print('REMOTE_CANCEL_PASS')
 except Exception as exc:print('REMOTE_CANCEL',type(exc).__name__,str(exc),'head_unchanged',w.head()==before)
 s=w.snapshot();print('CELL_AFTER_CANCEL',{'tick':s['tick'],'cell_gate':next(iter(s['staging']['cells'].values()))['gate'],'cell_expires':next(iter(s['staging']['cells'].values()))['expires_tick'],'actor_node':s['actors']['reviewer']['node'],'reserved_unique_bytes':s['staging']['metrics']['reserved_unique_bytes']})
