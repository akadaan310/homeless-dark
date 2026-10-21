"""Real bounded JavaScript computation producing typed proposals, never commits."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

from .world import canonical

ROOT=Path(__file__).resolve().parents[2]


class WorkerRefused(Exception):pass


class ScriptWorker:
    def __init__(self,binary=None):
        self.binary=Path(binary or ROOT/'artifacts/workers/dark-js')

    def run(self,source,observation):
        from .protocol import OPS,PARAMETERS
        if not isinstance(source,str) or not isinstance(observation,dict):raise WorkerRefused('source string and permitted observation required')
        try:
            if len(source.encode())>16384 or len(canonical(observation).encode())>45000:raise WorkerRefused('input budget')
            # The observation is a serialized copy scoped by World.observe; there
            # are no server objects, tokens or callbacks in this process.
            program='"use strict";const observation='+canonical(observation)+';(()=>{'+source+'\n})()'
            raw=program.encode('utf-8')
        except (ValueError,TypeError,UnicodeError) as exc:raise WorkerRefused('finite UTF-8 JSON required') from exc
        if len(raw)>65536:raise WorkerRefused('input budget')
        if not self.binary.is_file():raise WorkerRefused('worker unavailable: run tools/workers/build.py')
        started=time.monotonic()
        try:
            result=subprocess.run([str(self.binary)],input=raw,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=2,
                                  env={'LANG':'C','LC_ALL':'C'},close_fds=True)
        except (OSError,subprocess.TimeoutExpired) as exc:raise WorkerRefused('worker unavailable or exceeded deadline') from exc
        if result.returncode or not 1<=len(result.stdout)<=65537 or result.stderr:raise WorkerRefused('script refused or exceeded a worker budget')
        try:proposals=json.loads(result.stdout)
        except (ValueError,UnicodeError) as exc:raise WorkerRefused('worker response malformed') from exc
        if not isinstance(proposals,list) or len(proposals)>16:raise WorkerRefused('maximum 16 typed proposals required')
        for item in proposals:
            if not isinstance(item,dict) or set(item)!={'operation','arguments'} or item['operation'] not in OPS or not isinstance(item['arguments'],dict):
                raise WorkerRefused('proposal schema or operation refused')
            if set(item['arguments'])!=set(PARAMETERS[item['operation']]):raise WorkerRefused('proposal argument schema refused')
            if len(canonical(item).encode())>8192:raise WorkerRefused('proposal budget')
        return {'status':'PROPOSED','proposals':proposals,'program_digest':hashlib.sha256(source.encode()).hexdigest(),
                'observation_digest':hashlib.sha256(canonical(observation).encode()).hexdigest(),
                'duration_ms':round((time.monotonic()-started)*1000,3),'authority_granted':False,
                'activation':'submit each proposal through current World admission with explicit request ID and revision'}
