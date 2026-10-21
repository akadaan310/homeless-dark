#!/usr/bin/env python3
"""Operator CLI and authenticated client for the persistent HOMELESS authority."""
import argparse
import json
import os
from pathlib import Path
import signal
import sys
import threading
import time
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'packages'))
from dark_server.world import World, Refused, canonical
from dark_server.protocol import Client, NetworkFailure, create_server
from dark_server.worker import ScriptWorker,WorkerRefused
from dark_server.continuity import Outbox,Seurl,ContinuityRefused


def token_file(path):
    source=Path(path)
    if source.stat().st_size>4096:raise ValueError('token file exceeds 4096 bytes')
    return source.read_text().strip()


def private_write(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w') as stream:stream.write(value+'\n')


def serve(world,port):
    server=create_server(world,port=port)
    stopped=threading.Event()
    errors=[]
    def ticker():
        serial=0;run_id=uuid.uuid4().hex;next_tick=time.monotonic()+1
        while not stopped.wait(max(0,next_tick-time.monotonic())):
            # Catch-up is bounded to five seconds. Long stalls remain explicit;
            # a process restart never invents offline detailed NPC activity.
            lag=max(1,min(5,int(time.monotonic()-next_tick)+1))
            try:world.advance(lag,run_id+':'+str(serial))
            except Exception as exc:
                errors.append(type(exc).__name__);stopped.set();server.shutdown();return
            serial+=1;next_tick=time.monotonic()+1
    thread=threading.Thread(target=ticker,name='dark-authoritative-clock',daemon=True);thread.start()
    def stop(_signum,_frame):
        stopped.set()
        threading.Thread(target=server.shutdown,daemon=True).start()
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,stop)
    print(canonical({'status':'LISTENING','url':'http://127.0.0.1:'+str(server.server_address[1]),
        'clock':'fixed simulated seconds; bounded catch-up=5','native_validation':'NOT_RUN'}),flush=True)
    try:server.serve_forever(poll_interval=.1)
    finally:stopped.set();server.server_close();thread.join(3)
    if errors:raise RuntimeError('simulation loop failed: '+errors[0])


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--world',default=str(ROOT/'artifacts/world.sqlite3'))
    sub=p.add_subparsers(dest='command',required=True)
    init=sub.add_parser('init');init.add_argument('--content',default=str(ROOT/'assets/content/world/opening.json'))
    reg=sub.add_parser('register');reg.add_argument('actor');reg.add_argument('--token-file',required=True)
    reg.add_argument('--scope',action='append',default=[]);reg.add_argument('--controller',choices=['human','external_ai'],default='human')
    join=sub.add_parser('join');join.add_argument('--token-file',required=True);join.add_argument('--request-id',default='initial-join')
    server=sub.add_parser('serve');server.add_argument('--port',type=int,default=8765)
    sub.add_parser('verify')
    adv=sub.add_parser('advance');adv.add_argument('seconds',type=int);adv.add_argument('--request-id',required=True)
    for name in ('observe','invoke','validate','controller','script','flush','reconcile'):
        cmd=sub.add_parser(name);cmd.add_argument('--url',default='http://127.0.0.1:8765');cmd.add_argument('--token-file',required=True)
        if name in ('invoke','validate'):
            cmd.add_argument('operation');cmd.add_argument('--arguments',default='{}');cmd.add_argument('--request-id',required=True)
            cmd.add_argument('--revision',type=int,required=True)
        if name=='controller':cmd.add_argument('--steps',type=int,default=6)
        if name=='script':
            cmd.add_argument('--source',required=True);cmd.add_argument('--outbox')
            cmd.add_argument('--deadline-seconds',type=int,default=300)
        if name in ('flush','reconcile'):cmd.add_argument('--outbox',required=True)
        if name=='reconcile':cmd.add_argument('--after',type=int,default=0)
    sealed=sub.add_parser('seurl');sealed.add_argument('operation',choices=['keygen','mint','parse'])
    sealed.add_argument('--key-file',required=True);sealed.add_argument('--actor');sealed.add_argument('--verb')
    sealed.add_argument('--payload',default='{}');sealed.add_argument('--url');sealed.add_argument('--expires',type=int)
    args=p.parse_args();started=time.monotonic()
    try:
        if args.command=='init':
            if Path(args.content).stat().st_size>8*1024*1024:raise ValueError('content exceeds 8 MiB')
            w=World.create(args.world,json.loads(Path(args.content).read_text()))
            result={'status':'CREATED','world':str(w.path),'head':w.head()}
        elif args.command=='register':
            if Path(args.token_file).exists():raise FileExistsError('token file exists; choose a new private path')
            w=World(args.world);token=w.register(args.actor,args.scope,controller=args.controller)
            private_write(args.token_file,token)
            result={'status':'REGISTERED','actor':args.actor,'role':'member','token_file':str(Path(args.token_file).resolve())}
        elif args.command=='join':result=World(args.world).join(token_file(args.token_file),args.request_id)
        elif args.command=='verify':result=World(args.world).verify_history()
        elif args.command=='advance':result=World(args.world).advance(args.seconds,args.request_id)
        elif args.command=='serve':serve(World(args.world),args.port);return 0
        elif args.command=='seurl':
            if args.operation=='keygen':
                private_write(args.key_file,os.urandom(32).hex());result={'status':'KEY_CREATED','key_file':str(Path(args.key_file).resolve())}
            else:
                codec=Seurl(bytes.fromhex(token_file(args.key_file)))
                if args.operation=='mint':result={'status':'DESCRIBED','url':codec.mint(args.actor,args.verb,json.loads(args.payload),args.expires),'authority_granted':False}
                else:result=codec.parse(args.url,args.actor)
        else:
            client=Client(args.url,token_file(args.token_file))
            if args.command=='observe':result=client.observe()
            elif args.command in ('invoke','validate'):
                request=client.proposal(args.operation,json.loads(args.arguments),args.request_id,args.revision)
                result=getattr(client,args.command)(request)
            elif args.command=='script':
                source=Path(args.source)
                if source.stat().st_size>16384:raise ValueError('program maximum16KiB')
                obs=client.observe();result=ScriptWorker().run(source.read_text(),obs)
                if args.outbox:
                    if not 1<=args.deadline_seconds<=86400:raise ValueError('deadline1..86400seconds')
                    outbox=Outbox(args.outbox);now=int(time.time());prepared=[]
                    for index,proposal in enumerate(result['proposals']):
                        request=client.proposal(proposal['operation'],proposal['arguments'],
                            'script:'+result['program_digest'][:24]+':'+obs['head'][:24]+':'+str(index),obs['revision']+index)
                        prepared.append(outbox.prepare(obs['actor']['id'],request,deadline=now+args.deadline_seconds,now=now))
                    result['prepared']=prepared
                    result['revision_policy']='ordered exact intents; concurrent world changes refuse stale actions without rebasing'
            elif args.command in ('flush','reconcile'):
                obs=client.observe();actor=obs['actor']['id'];outbox=Outbox(args.outbox)
                if args.command=='flush':result=outbox.flush(actor,client)
                else:
                    if args.after<0:raise ValueError('nonnegative event cursor required')
                    receipts=client.request('/r/world/events?after='+str(args.after)+'&limit=128')['events']
                    result={'reconciliation':outbox.reconcile(actor,receipts),'next_cursor':max([args.after]+[r['seq'] for r in receipts])}
                result['outbox']=outbox.inspect(actor)
            else:
                if not 1<=args.steps<=64:raise ValueError('controller budget is 1–64 steps')
                run=uuid.uuid4().hex;records=[]
                for i in range(args.steps):
                    obs=client.observe();nearby=sorted(obs['nearby'])
                    if i%3==0 and nearby:
                        op,arguments='talk',{'target':next((n for n in nearby if n in ('mira','omar','lina')),nearby[0]),'act':'greeting'}
                    else:op,arguments=('sit' if i%2 else 'stand'),{}
                    proposal=client.proposal(op,arguments,'controller:'+run+':'+str(i),obs['revision'])
                    try:record=client.invoke(proposal)
                    except NetworkFailure as exc:record={'status':'REFUSED','http_status':exc.status}
                    records.append({'operation':op,'result':record})
                result={'status':'FINISHED','controller':'actual external deterministic policy process; not an LLM', 'steps':records}
        print(canonical({'schema':'darkctl.result/1','duration_ms':round((time.monotonic()-started)*1000,3),'result':result,'exit_status':0}))
        return 0
    except (Refused,NetworkFailure,WorkerRefused,ContinuityRefused,ValueError,OSError,RuntimeError) as exc:
        result=exc.as_dict() if isinstance(exc,Refused) else {'status':'REFUSED','reason':str(exc)}
        print(canonical({'schema':'darkctl.result/1','result':result,'exit_status':2}));return 2


if __name__=='__main__':raise SystemExit(main())
