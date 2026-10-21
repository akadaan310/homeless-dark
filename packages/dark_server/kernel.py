"""Bounded process adapter to the existing C# kernels; no additional world authority."""
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import tempfile
import time

ROOT=Path(__file__).resolve().parents[2]
LIMIT=1024*1024

class KernelError(Exception):
    def __init__(self,code,message):self.code=code;super().__init__(code+': '+message)

class KernelBridge:
    def __init__(self,dotnet=None,dll=None,timeout=10):
        self.dotnet=str(dotnet or os.environ.get('DARK_DOTNET') or shutil.which('dotnet') or '/tmp/homeless-dotnet/dotnet')
        self.dll=Path(dll or ROOT/'tools/Dark.KernelBridge/bin/Release/net8.0/Dark.KernelBridge.dll').resolve()
        if not isinstance(timeout,(int,float)) or isinstance(timeout,bool) or not 0<timeout<=10:raise ValueError('timeout must be 0–10 seconds')
        self.timeout=timeout

    @classmethod
    def build(cls,dotnet=None):
        executable=str(dotnet or os.environ.get('DARK_DOTNET') or shutil.which('dotnet') or '/tmp/homeless-dotnet/dotnet')
        env=dict(os.environ,DOTNET_CLI_TELEMETRY_OPTOUT='1',DOTNET_NOLOGO='1')
        result=subprocess.run([executable,'build',str(ROOT/'tools/Dark.KernelBridge/Dark.KernelBridge.csproj'),'--configuration','Release','--nologo'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=120,check=False)
        if result.returncode:raise KernelError('KERNEL_BUILD',result.stdout[-16000:].decode('utf-8','replace'))
        return result.stdout.decode('utf-8','replace')

    def call(self,operation,arguments):
        if not isinstance(operation,str) or len(operation)>64 or not isinstance(arguments,dict):raise KernelError('KERNEL_REQUEST','operation string and arguments object required')
        try:data=json.dumps({'schema':'dark.kernel-request/1','operation':operation,'arguments':arguments},ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8')
        except (ValueError,TypeError,UnicodeError,RecursionError) as exc:raise KernelError('KERNEL_REQUEST_ENCODING','finite UTF-8 JSON required') from exc
        if len(data)>LIMIT:raise KernelError('KERNEL_INPUT_BUDGET','maximum 1 MiB')
        if not self.dll.is_file():raise KernelError('KERNEL_UNAVAILABLE','build Dark.KernelBridge first')
        env=dict(os.environ,DOTNET_CLI_TELEMETRY_OPTOUT='1',DOTNET_NOLOGO='1')
        with tempfile.TemporaryFile() as source:
            source.write(data);source.seek(0)
            try:process=subprocess.Popen([self.dotnet,str(self.dll)],stdin=source,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,env=env,start_new_session=True)
            except OSError as exc:raise KernelError('KERNEL_UNAVAILABLE',str(exc)) from exc
            output={};deadline=time.monotonic()+self.timeout
            try:
                with selectors.DefaultSelector() as select:
                    for stream in (process.stdout,process.stderr):
                        os.set_blocking(stream.fileno(),False);select.register(stream,selectors.EVENT_READ);output[stream]=bytearray()
                    while select.get_map():
                        remaining=deadline-time.monotonic()
                        if remaining<=0:raise KernelError('KERNEL_TIMEOUT','kernel exceeded deadline')
                        for key,_ in select.select(remaining):
                            chunk=os.read(key.fileobj.fileno(),65536)
                            if not chunk:select.unregister(key.fileobj);continue
                            output[key.fileobj].extend(chunk)
                            if sum(map(len,output.values()))>LIMIT:raise KernelError('KERNEL_OUTPUT_BUDGET','stdout and stderr exceed 1 MiB')
                remaining=deadline-time.monotonic()
                if remaining<=0:raise KernelError('KERNEL_TIMEOUT','kernel exceeded deadline')
                try:code=process.wait(timeout=remaining)
                except subprocess.TimeoutExpired as exc:raise KernelError('KERNEL_TIMEOUT','kernel exceeded deadline') from exc
                if code:raise KernelError('KERNEL_EXIT','kernel exit '+str(code))
                try:
                    def unique_pairs(pairs):
                        obj={}
                        for key,value in pairs:
                            if key in obj:raise ValueError('duplicate response key')
                            obj[key]=value
                        return obj
                    result=json.loads(bytes(output[process.stdout]).decode('utf-8'),object_pairs_hook=unique_pairs,
                        parse_constant=lambda value:(_ for _ in ()).throw(ValueError('nonfinite response')))
                except (ValueError,UnicodeError,RecursionError) as exc:raise KernelError('KERNEL_PROTOCOL','invalid JSON response') from exc
                if not isinstance(result,dict) or result.get('schema')!='dark.kernel-result/1' or result.get('operation')!=operation or result.get('status') not in ('OK','VALID','ADMITTED','REFUSED') or result.get('authority_granted') is not False or result.get('physical_validation')!='NOT_RUN':raise KernelError('KERNEL_PROTOCOL','unexpected response envelope')
                return result
            finally:
                if process.poll() is None:
                    try:os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    process.wait(timeout=2)
                process.stdout.close();process.stderr.close()
