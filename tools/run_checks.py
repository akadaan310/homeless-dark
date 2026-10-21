#!/usr/bin/env python3
"""Run all available portable checks, retain logs, and never imply native acceptance."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'evidence/verification'

def source_digest():
    files=[]
    for directory in ('packages','tools','tests','unity','assets','data'):
        for path in sorted((ROOT/directory).rglob('*')):
            if not path.is_file() or any(part in {'bin','obj','__pycache__','Library','Logs','Temp','Builds','cache'} for part in path.parts): continue
            relative=path.relative_to(ROOT).as_posix()
            files.append({'path':relative,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    canonical=json.dumps(sorted(files,key=lambda r:r['path']),sort_keys=True,separators=(',',':')).encode()
    return hashlib.sha256(canonical).hexdigest(),files

def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    sdk=os.environ.get('DARK_DOTNET') or shutil.which('dotnet')
    if not sdk:
        print('BLOCKED: set DARK_DOTNET to an installed .NET 8 SDK executable',file=sys.stderr);return 2
    env=os.environ.copy();env.update(DARK_DOTNET=sdk,DOTNET_CLI_TELEMETRY_OPTOUT='1',DOTNET_NOLOGO='1',PYTHONDONTWRITEBYTECODE='1')
    commands=[
        ('core',[sdk,'run','--project','tests/Dark.Core.Tests']),
        ('mathematics',[sdk,'run','--project','tests/Dark.Math.Tests']),
        ('cli-build',[sdk,'build','tools/Dark.Cli']),
        ('cli-projection',[sys.executable,'-m','unittest','discover','-s','tests','-p','test_*.py']),
        ('art',[sys.executable,'-m','unittest','discover','-s','tools/art','-p','test_*.py']),
        ('geography',[sys.executable,'-m','unittest','discover','-s','tests/geography','-p','test_*.py']),
        ('art-integrity',[sys.executable,'tools/art/fetch_materials.py','--verify']),
        ('commission',[sys.executable,'tools/commission.py','verify']),
    ]
    if (ROOT/'tests/audio').is_dir():commands.append(('audio',[sys.executable,'-m','unittest','discover','-s','tests/audio','-p','test_*.py']))
    if (ROOT/'tests/telemetry').is_dir():commands.append(('telemetry',[sys.executable,'-m','unittest','discover','-s','tests/telemetry','-p','test_*.py']))
    if (ROOT/'tests/Dark.Population.Tests').is_dir():commands.append(('population',[sdk,'run','--project','tests/Dark.Population.Tests']))
    if (ROOT/'tests/Dark.Geography.Tests').is_dir():commands.append(('tampa-kernel',[sdk,'run','--project','tests/Dark.Geography.Tests']))
    if (ROOT/'tests/Dark.PopulationAllocation.Tests').is_dir():commands.append(('global-population',[sdk,'run','--project','tests/Dark.PopulationAllocation.Tests']))
    if (ROOT/'tests/server').is_dir():commands.append(('world-server',[sys.executable,'-m','unittest','discover','-s','tests/server','-p','test_*.py']))
    if (ROOT/'tests/content').is_dir():commands.append(('content',[sys.executable,'-m','unittest','discover','-s','tests/content','-p','test_*.py']))
    if (ROOT/'tools/environment/WorldWireTests').is_dir():commands.append(('native-wire',[sdk,'run','--project','tools/environment/WorldWireTests']))
    if (ROOT/'tools/environment/world_wire_check.py').is_file():commands.append(('native-wire-interop',[sys.executable,'tools/environment/world_wire_check.py']))
    if (ROOT/'tools/environment/terrain_wire_check.py').is_file():commands.append(('terrain-wire',[sys.executable,'tools/environment/terrain_wire_check.py']))
    managed=os.environ.get('DARK_UNITY_MANAGED')
    editor=Path(os.environ.get('DARK_UNITY_EDITOR','/tmp/homeless-native/unity-squashfs/Editor'))
    if (editor/'Data/Managed/UnityEngine/UnityEngine.CoreModule.dll').is_file():
        commands.append(('unity-api-compile',[sys.executable,'tools/environment/unity_api_check.py','--editor',str(editor),'--dotnet',sdk]))
    elif managed:commands.append(('unity-api-compile',[sdk,'build','tools/environment/UnityApiCompile','-p:UnityManagedDir='+managed]))
    initial,files=source_digest();results=[]
    for name,argv in commands:
        start=time.monotonic()
        try:
            run=subprocess.run(argv,cwd=ROOT,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
            code=run.returncode;output=run.stdout
        except (OSError,subprocess.TimeoutExpired) as error:
            code=124;output=str(error)
        log=OUTPUT/(name+'.log');log.write_text(output,encoding='utf-8')
        result={'name':name,'argv':argv,'exit_code':code,'status':'PASS' if code==0 else 'FAIL',
                'duration_seconds':round(time.monotonic()-start,3),'log':log.relative_to(ROOT).as_posix(),
                'log_sha256':hashlib.sha256(log.read_bytes()).hexdigest()}
        results.append(result);print(name+': '+result['status'],flush=True)
    final,_=source_digest()
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    report={'schema':'homeless.portable-verification/1','recorded_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'base_commit':commit,'working_tree_source_sha256':initial,'source_unchanged_during_run':initial==final,
            'results':results,'unity_import':'NOT_RUN','unity_adapter_compile':next((r['status'] for r in results if r['name']=='unity-api-compile'),'NOT_RUN'),'android_build':'NOT_RUN',
            'device_tests':'NOT_RUN','native_visual_acceptance':'NOT_RUN','release_accepted':False}
    (OUTPUT/'source-files.json').write_text(json.dumps(files,indent=2)+'\n')
    (OUTPUT/'latest.json').write_text(json.dumps(report,indent=2)+'\n')
    return 0 if initial==final and all(r['exit_code']==0 for r in results) else 1

if __name__=='__main__':raise SystemExit(main())
