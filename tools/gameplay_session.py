#!/usr/bin/env python3
"""Execute a source-backed multiplayer gameplay session through actual loopback HTTP.

Retains the world and sanitized transcript. Three actual policy clients are
exercised, not three human attendees or an external LLM. No native claim.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import threading
import time

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'packages'))
from dark_server.world import World,canonical
from dark_server.protocol import Client,create_server
from dark_server.kernel import KernelBridge
from dark_server.worker import ScriptWorker
from dark_server.continuity import Outbox


def run(directory):
    directory=Path(directory).resolve();directory.mkdir(parents=True,exist_ok=True)
    source=ROOT/'assets/content/world/opening.json';KernelBridge.build()
    world=World.create(directory/'world.sqlite3',json.loads(source.read_text()))
    tokens={name:world.register(name,scopes=['author/fictional:cafe-apron'] if name=='traveler' else [],
        controller='external_ai' if name=='external-policy' else 'human') for name in ('traveler','companion','external-policy')}
    for name,token in tokens.items():world.join(token,'join-'+name)
    server=create_server(world,port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    clients={name:Client('http://127.0.0.1:'+str(server.server_address[1]),token,timeout=10) for name,token in tokens.items()}
    transcript=[];serial=0;started=time.monotonic()
    def act(op,args=None,name='traveler'):
        nonlocal serial
        serial+=1;client=clients[name];obs=client.observe()
        proposal=client.proposal(op,args or {},'session:'+str(serial),obs['revision'])
        result=client.invoke(proposal);transcript.append({'actor':name,'request':proposal,'result':result})
        return result
    def advance(seconds):
        nonlocal serial
        serial+=1;world.advance(seconds,'session-clock:'+str(serial))
    def arrive(name='traveler',budget=48):
        for _ in range(budget):
            if not clients[name].observe()['journey']:return
            advance(3600)
        raise AssertionError('journey exceeded declared48simulatedhour budget')
    def walk(node):act('travel',{'destination':node,'mode':'walk'});arrive()
    try:
        act('talk',{'target':'mira','act':'greeting'})
        assert act('talk',{'target':'mira','act':'request_ride'})['data']['response_act']=='offer_ride'
        assert act('talk',{'target':'omar','act':'request_ride'})['data']['response_act']=='decline_ride'
        act('sit',name='companion');act('stand',name='companion')
        act('talk',{'target':'mira','act':'greeting'},name='external-policy')
        act('prepare_cell',{'cell':'cafe-apron'});act('activate_cell',{'cell':'cafe-apron'});act('retire_cell',{'cell':'cafe-apron'})
        act('entity_action',{'entity':'building:cafe','ability':'set_light','input':{'level':.65}})
        act('request_entry',{'entity':'building:cafe'})
        neighbor=act('encounter_population',{'key':'opening-neighbor'})['data']
        assert neighbor['metrics']['active_actors']==1
        act('talk',{'target':neighbor['spawn']['world_actor_id'],'act':'greeting'})
        obs=clients['traveler'].observe()
        program='return [{operation:"author",arguments:{target:"fictional:cafe-apron",text:"There is room for a shared story here."}}];'
        computation=ScriptWorker().run(program,obs);proposal=computation['proposals'][0]
        out=Outbox(directory/'outbox.sqlite3');now=int(time.time())
        request=clients['traveler'].proposal(proposal['operation'],proposal['arguments'],'session-script',obs['revision'])
        out.prepare('traveler',request,now+300,now=now);assert out.flush('traveler',clients['traveler'])['delivered']==1
        transcript.append({'script':computation,'request':request,'result':out.inspect('traveler')})
        # Physically travel the observed motif before learning its bounded rule.
        for node in ('osm:node:2057042478','osm:node:1603574189','osm:node:8066816959','osm:node:1603574189'):walk(node)
        act('learn_pattern',{'lesson':'spruce-quarter-turn','answer':'quarter-turn-left'})
        for _ in range(5):
            if not world.snapshot()['journeys']:break
            advance(60)
        act('rewrite_plate',{'direction':'forward','policy':'RigidCarriage'});advance(4)
        old_head=world.head();world=World(directory/'world.sqlite3')
        assert world.head()==old_head;advance(4)
        act('rewrite_plate',{'direction':'inverse','policy':'RigidCarriage'});advance(8)
        walk('fictional:taxi-stop');act('board',{'vehicle':'civic-taxi','seat':'passenger'})
        act('consent_trip',{'destination':'fictional:cafe-apron','max_distance_m':100})
        act('travel',{'destination':'fictional:cafe-apron','mode':'taxi'});arrive();act('exit')
        walk('fictional:air-transfer');act('board',{'vehicle':'opening-shuttle','seat':'passenger'})
        act('consent_trip',{'destination':'airport:KTPA','max_distance_m':100000})
        act('travel',{'destination':'airport:KTPA','mode':'helicopter'});arrive();act('exit')
        act('board',{'vehicle':'civil-aircraft','seat':'driver'})
        act('travel',{'destination':'airport:EGLL','mode':'aircraft'});arrive();act('exit')
        obs=clients['traveler'].observe();assert obs['actor']['node']=='airport:EGLL'
        terrain=clients['traveler'].request('/r/world/terrain?lat='+str(obs['actor']['position']['lat'])+'&lon='+str(obs['actor']['position']['lon'])+'&width=3&span=2000')
        verification=world.verify_history()
        result={'schema':'dark.gameplay-session/1','status':'PASS','duration_seconds':round(time.monotonic()-started,3),
            'content_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'final_node':obs['actor']['node'],
            'simulated_seconds':obs['tick'],'verification':verification,'terrain_source':terrain['sources'],
            'protocol':'actual loopback HTTP with three separately authenticated clients','participants':'two human-role test clients and one external deterministic policy client; no human/LLM attendance claim',
            'native_rendering':'NOT_RUN','physical_validation':'headless routes and portable authored volumes only',
            'transcript':transcript,'world':str(world.path)}
        (directory/'session.json').write_text(json.dumps(result,indent=2)+'\n')
        return result
    finally:server.shutdown();server.server_close();thread.join(3)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True);parser.add_argument('--report')
    args=parser.parse_args();result=run(args.output)
    if args.report:Path(args.report).write_text(json.dumps(result,indent=2)+'\n')
    print(canonical({k:v for k,v in result.items() if k!='transcript'}))
