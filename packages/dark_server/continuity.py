"""Durable store-and-forward and a finite SEURL adapter. HD-069, HD-070, HD-078.

The inspected SEURL source defines seven verbs, not an executable wire server.
This named HOMELESS adapter supplies bounded sealed descriptions. URL integrity
does not authenticate a session or authorize effects; World admission still does.
"""
import base64
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import time
from urllib.parse import urlsplit

from .world import canonical, identifier, Refused
from .protocol import NetworkFailure, strict_json, OPS


class ContinuityRefused(Exception):pass


def check(condition,message):
    if not condition:raise ContinuityRefused(message)


def stamp(value):
    value=int(time.time()) if value is None else value
    check(type(value) is int and value>=0,'trusted nonnegative integer time required')
    return value


class Outbox:
    def __init__(self,path):
        self.path=Path(path).resolve();self.path.parent.mkdir(parents=True,exist_ok=True)
        created=False
        try:
            fd=os.open(self.path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd);created=True
        except FileExistsError:pass
        with self._connect() as c:
            if created:
                c.executescript('''CREATE TABLE metadata(version INTEGER NOT NULL);INSERT INTO metadata VALUES(2);
                  CREATE TABLE outbox(actor TEXT NOT NULL,request_id TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,
                    created INTEGER NOT NULL,deadline INTEGER NOT NULL,state TEXT NOT NULL,response TEXT,
                    PRIMARY KEY(actor,request_id));''')
            try:version=c.execute('SELECT version FROM metadata').fetchone()
            except sqlite3.Error as exc:raise ContinuityRefused('existing outbox is corrupt or has unsupported schema; never reseed') from exc
            check(version is not None and version[0] in (1,2),'outbox migration required')
            if version[0]==1:
                # v1 left both never-sent and unknown-outcome rows "prepared".
                # Their dispatch history cannot be reconstructed safely.
                c.execute('BEGIN IMMEDIATE')
                c.execute("UPDATE outbox SET state='unknown',response=? WHERE state='prepared'",
                          (canonical({'reason':'legacy dispatch history unavailable; exact retry or receipt reconciliation required','may_have_committed':True}),))
                c.execute('UPDATE metadata SET version=2')

    @contextmanager
    def _connect(self):
        c=sqlite3.connect('file:'+str(self.path)+'?mode=rw',uri=True,timeout=5);c.row_factory=sqlite3.Row
        c.execute('PRAGMA synchronous=FULL')
        try:
            with c:yield c
        finally:c.close()

    def prepare(self,actor,request,deadline,now=None):
        identifier(actor);now=stamp(now);deadline=stamp(deadline)
        check(now<deadline<=now+86400,'deadline must be within one day')
        check(isinstance(request,dict) and set(request)=={'schema','request_id','expected_revision','operation','arguments'},'action envelope required')
        identifier(request['request_id'])
        check(request['schema']=='dark.action/1' and isinstance(request['operation'],str) and request['operation'] in OPS and isinstance(request['arguments'],dict)
              and type(request['expected_revision']) is int and request['expected_revision']>=0,'invalid action schema')
        try:text=canonical(request);raw=text.encode()
        except (ValueError,TypeError,UnicodeError) as exc:raise ContinuityRefused('finite UTF-8 action required') from exc
        check(len(raw)<=8192,'action maximum 8192 bytes')
        digest=hashlib.sha256(raw).hexdigest()
        with self._connect() as c:
            c.execute('BEGIN IMMEDIATE')
            old=c.execute('SELECT * FROM outbox WHERE actor=? AND request_id=?',(actor,request['request_id'])).fetchone()
            if old:
                check(old['digest']==digest and old['payload']==text and old['deadline']==deadline,'altered duplicate intent')
                return {'status':'EXISTING','state':old['state'],'digest':digest}
            check(c.execute('SELECT count(*) FROM outbox').fetchone()[0]<256,'outbox retention budget reached; archive explicitly')
            c.execute('INSERT INTO outbox VALUES(?,?,?,?,?,?,?,NULL)',(actor,request['request_id'],text,digest,now,deadline,'prepared'))
        return {'status':'PREPARED','digest':digest,'authority_granted':False}

    def inspect(self,actor):
        identifier(actor)
        with self._connect() as c:
            return [{'request_id':r['request_id'],'state':r['state'],'digest':r['digest'],'deadline':r['deadline'],
                     'may_have_committed':r['state'] in ('attempted','unknown','unknown_expired','delivered'),
                     'response':json.loads(r['response']) if r['response'] else None}
                    for r in c.execute('SELECT * FROM outbox WHERE actor=? ORDER BY created,request_id',(actor,))]

    def cancel(self,actor,request_id):
        identifier(actor);identifier(request_id)
        with self._connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute('SELECT state FROM outbox WHERE actor=? AND request_id=?',(actor,request_id)).fetchone()
            check(row is not None,'unknown outbox request')
            check(row['state'] in ('prepared','cancelled'),'cannot cancel a dispatched or terminal intent; it may already have committed')
            c.execute("UPDATE outbox SET state='cancelled' WHERE actor=? AND request_id=? AND state='prepared'",(actor,request_id))
        return {'status':'CANCELLED','request_id':request_id,'dispatched':False}

    def reconcile(self,actor,receipts):
        """Reconcile authenticated caller-owned World.own_events receipts.

        This local helper cannot authenticate supplied JSON. The CLI/host must
        fetch receipts using the current session and verify its actor equals
        ``actor``. It never invokes HTTP effects or refreshes request intent.
        Absence from one bounded history page says nothing about commitment.
        """
        identifier(actor)
        check(isinstance(receipts,list) and len(receipts)<=128,'maximum128 own-event receipts')
        try:check(len(canonical(receipts).encode('utf-8'))<=1048576,'receipt page maximum1MiB')
        except (ValueError,TypeError,UnicodeError,RecursionError) as exc:raise ContinuityRefused('finite bounded receipt page required') from exc
        counts={'delivered':0,'already_delivered':0,'ignored':0}
        with self._connect() as c:
            c.execute('BEGIN IMMEDIATE')
            for receipt in receipts:
                check(isinstance(receipt,dict) and set(receipt)=={'seq','command','response','previous','hash','state_hash'},'own-event receipt fields required')
                command,response=receipt['command'],receipt['response']
                check(isinstance(command,dict) and isinstance(command.get('request_id'),str),'receipt command request ID required')
                identifier(command['request_id'])
                check(type(receipt['seq']) is int and receipt['seq']>0 and isinstance(response,dict)
                      and response.get('status')=='COMMITTED' and type(response.get('revision')) is int
                      and response['revision']==receipt['seq'],'only committed matching-revision receipts reconcile')
                row=c.execute('SELECT * FROM outbox WHERE actor=? AND request_id=?',(actor,command['request_id'])).fetchone()
                if row is None:counts['ignored']+=1;continue
                exact=canonical(command)
                check(exact==row['payload'] and hashlib.sha256(exact.encode()).hexdigest()==row['digest'],'receipt command differs from exact prepared intent')
                if row['state']=='delivered':
                    check(canonical(response)==row['response'],'receipt conflicts with previously confirmed response')
                    counts['already_delivered']+=1;continue
                c.execute("UPDATE outbox SET state='delivered',response=? WHERE actor=? AND request_id=?",(canonical(response),actor,command['request_id']))
                counts['delivered']+=1
        return counts

    def flush(self,actor,client,now=None):
        identifier(actor);live_clock=now is None;now=stamp(now)
        counts={'delivered':0,'pending':0,'expired':0,'rejected':0,'unknown_expired':0}
        with self._connect() as c:
            rows=c.execute("SELECT request_id FROM outbox WHERE actor=? AND state IN ('prepared','attempted','unknown') ORDER BY created,request_id LIMIT 16",(actor,)).fetchall()
        for row in rows:
            if live_clock:now=stamp(None)
            # Selection, cancellation and claiming serialize in SQLite. Commit
            # the attempted marker BEFORE crossing the HTTP boundary. A crash
            # here is conservatively ambiguous, never safe to "cancel".
            with self._connect() as c:
                c.execute('BEGIN IMMEDIATE')
                current=c.execute('SELECT * FROM outbox WHERE actor=? AND request_id=?',(actor,row['request_id'])).fetchone()
                if current is None or current['state'] not in ('prepared','attempted','unknown'):continue
                check(hashlib.sha256(current['payload'].encode()).hexdigest()==current['digest'],'outbox payload corruption')
                previously_attempted=current['state']!='prepared'
                if now>=current['deadline']:
                    state='unknown_expired' if previously_attempted else 'expired'
                    response={'reason':'deadline prevents HTTP retry; reconcile original server receipt without changing ID or intent' if previously_attempted else 'never-dispatched deadline elapsed',
                              'may_have_committed':previously_attempted,'deadline_prevents_retry':True}
                    c.execute('UPDATE outbox SET state=?,response=? WHERE actor=? AND request_id=?',(state,canonical(response),actor,current['request_id']))
                    counts[state]+=1
                    continue
                c.execute("UPDATE outbox SET state='attempted' WHERE actor=? AND request_id=?",(actor,current['request_id']))
            try:
                response=client.invoke(json.loads(current['payload']))
                check(isinstance(response,dict) and response.get('status')=='COMMITTED','expected a committed response; outcome remains attempted')
                state='delivered'
            except NetworkFailure as exc:
                # HTTP rejection on a retry cannot disprove an earlier commit.
                # 200 with a malformed response is also an unknown outcome.
                state='unknown'
                response={'http_status':exc.status,'reason':'this attempt failed; concurrent or prior dispatch outcome requires exact retry or receipt reconciliation',
                          'may_have_committed':True}
            with self._connect() as c:
                c.execute('BEGIN IMMEDIATE')
                # Concurrent exact retries may race. A confirmed COMMITTED
                # receipt dominates delayed failures and deadline ambiguity.
                allowed=('attempted','unknown','unknown_expired','rejected') if state=='delivered' else ('attempted','unknown')
                placeholders=','.join('?' for _ in allowed)
                changed=c.execute('UPDATE outbox SET state=?,response=? WHERE actor=? AND request_id=? AND state IN ('+placeholders+')',
                                  (state,canonical(response),actor,current['request_id'],*allowed)).rowcount
                if changed:counts['pending' if state=='unknown' else state]+=1
        return counts


class Seurl:
    VERBS={'START','SWITCH','WRITE','COMMIT','BUILD','TALK','PERTURB'}
    def __init__(self,key):
        check(isinstance(key,bytes) and len(key)>=32,'a private local 256-bit signing key is required')
        self.key=key

    def mint(self,actor,verb,payload,expires):
        identifier(actor);stamp(expires)
        check(isinstance(verb,str) and verb in self.VERBS and isinstance(payload,dict),'finite SEURL verb and typed payload required')
        try:raw=canonical({'schema':'dark.seurl/1','actor':actor,'verb':verb,'payload':payload,'expires':expires}).encode()
        except (ValueError,TypeError,UnicodeError) as exc:raise ContinuityRefused('finite UTF-8 program required') from exc
        check(len(raw)<=8192,'SEURL program maximum 8192 bytes')
        body=base64.urlsafe_b64encode(raw).decode().rstrip('=')
        seal=hmac.new(self.key,raw,hashlib.sha256).hexdigest()
        return 'seurl://dark/v1/'+body+'.'+seal

    def parse(self,url,actor,now=None):
        check(isinstance(url,str) and len(url)<=12000 and not any(c.isspace() for c in url),'URL only, with bounded length')
        parts=urlsplit(url)
        check(parts.scheme=='seurl' and parts.netloc=='dark' and parts.path.startswith('/v1/') and not parts.query and not parts.fragment,'unsupported SEURL address')
        try:
            body,seal=parts.path[4:].rsplit('.',1)
            check(len(seal)==64,'invalid seal')
            raw=base64.b64decode(body+'='*((-len(body))%4),altchars=b'-_',validate=True)
            check(len(raw)<=8192 and hmac.compare_digest(hmac.new(self.key,raw,hashlib.sha256).hexdigest(),seal),'program integrity failure')
            data=strict_json(raw)
        except (ValueError,UnicodeError) as exc:raise ContinuityRefused('invalid SEURL encoding') from exc
        check(isinstance(data,dict) and set(data)=={'schema','actor','verb','payload','expires'} and data['schema']=='dark.seurl/1','unsupported program schema')
        check(data['actor']==actor and stamp(data['expires'])>stamp(now),'wrong actor or expired program')
        verb,payload=data['verb'],data['payload']
        check(isinstance(verb,str) and verb in self.VERBS and isinstance(payload,dict),'unsupported verb or payload')
        mapped={'SWITCH':'overlay','WRITE':'author','TALK':'talk','PERTURB':'rewrite_plate'}
        if verb in mapped:proposal={'operation':mapped[verb],'arguments':payload}
        elif verb=='COMMIT':
            check(set(payload)=={'operation','arguments'} and isinstance(payload['operation'],str) and payload['operation'] in OPS and isinstance(payload['arguments'],dict),'COMMIT needs one prepared typed proposal')
            proposal=payload
        elif verb=='BUILD':
            check(set(payload)=={'source'} and isinstance(payload['source'],str),'BUILD needs bounded program source')
            proposal={'kind':'program-source','source':payload['source'],'requires':'bounded ScriptWorker; returns proposals only'}
        else:
            check(set(payload)<= {'channel'},'START accepts a channel only')
            proposal={'kind':'channel-start','channel':payload.get('channel','world'),'requires':'existing authenticated actor session'}
        return {'status':'DESCRIBED','verb':verb,'author':actor,'proposal':proposal,
                'program_digest':hashlib.sha256(raw).hexdigest(),'authority_granted':False,
                'scheme_registration':'application parser only; not an OS or libcurl transport'}
