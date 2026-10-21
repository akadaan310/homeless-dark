import importlib.util,sys,tempfile,json
from pathlib import Path
root=Path('/home/ubuntu/Documents/Codex/2026-10-21-new-chat/homeless-dark')
sys.path.insert(0,str(root/'packages'))
spec=importlib.util.spec_from_file_location('fixtures',root/'tests/server/test_world.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
from dark_server.world import World,Refused,distance_m

def action(w,token,op,args,req='test'):
 return w.execute(token,{'schema':'dark.action/1','request_id':req,'expected_revision':w.snapshot()['revision'],'operation':op,'arguments':args},now=102)
with tempfile.TemporaryDirectory() as tmp:
 w=World.create(Path(tmp)/'world.db',m.content());tok=w.register('car',now=100);w.join(tok,'join',now=101)
 start=w.snapshot()['vehicles']['car']['position'];action(w,tok,'travel',{'destination':'corner','mode':'walk'});w.advance(2,'advance')
 s=w.snapshot();print('NAMESPACE_COLLISION',json.dumps({'unboarded_actor':s['actors']['car']['vehicle'],'vehicle_displacement_m':distance_m(start,s['vehicles']['car']['position']),'actor_displacement_m':distance_m(start,s['actors']['car']['position']),'vehicle_driver':s['vehicles']['car']['driver']}))
with tempfile.TemporaryDirectory() as tmp:
 w=World.create(Path(tmp)/'world.db',m.content());tok=w.register('p',now=100);w.join(tok,'join',now=101)
 for i,(op,args) in enumerate([('talk',{'target':[],'act':'greeting'}),('travel',{'destination':{},'mode':'walk'}),('board',{'vehicle':[],'seat':'driver'}),('overlay',{'destination':[]})]):
  before=w.head()
  try:action(w,tok,op,args,str(i));print('MALFORMED',op,'ACCEPTED')
  except Exception as e:print('MALFORMED',op,type(e).__name__,str(e),'head_unchanged=',before==w.head())
 request={'schema':'dark.action/1','request_id':'badvalidate','expected_revision':w.snapshot()['revision'],'operation':'sit','arguments':{'x':float('nan')}}
 try:w.validate(tok,request,now=102)
 except Exception as e:print('VALIDATE_ENCODING',type(e).__name__,str(e))
 print('AUTH_BEFORE_ISSUANCE',w.identity(tok,now=0))
