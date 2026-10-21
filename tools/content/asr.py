#!/usr/bin/env python3
"""Pinned offline whisper.cpp acquisition, ARM CPU build and synthetic-corpus probe.
Recognized text is diagnostic evidence only. It never executes game/host commands.
"""
import argparse, audioop, hashlib, json, pathlib, re, subprocess, tarfile, time, urllib.request, wave
ROOT=pathlib.Path(__file__).resolve().parents[2]
MODEL=ROOT/'assets/content/asr'
EVIDENCE=ROOT/'evidence/content/asr'
WORK=pathlib.Path('/tmp/homeless-whisper-cpp')

def download(url,path,limit):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.partial')
    try:
        with urllib.request.urlopen(url,timeout=60) as r, temporary.open('wb') as f:
            size=0
            while True:
                chunk=r.read(1024*1024)
                if not chunk:break
                size+=len(chunk)
                if size>limit:raise ValueError('bounded download exceeded')
                f.write(chunk)
        temporary.replace(path)
    finally:
        if temporary.exists():temporary.unlink()
    return {'url':url,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

def prepare():
    selected=json.loads((ROOT/'assets/content/asr-selection.json').read_text());MODEL.mkdir(parents=True,exist_ok=True);EVIDENCE.mkdir(parents=True,exist_ok=True)
    archive=pathlib.Path('/tmp/homeless-whisper-source.tar.gz')
    code=download('https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/'+selected['runtime_revision'],archive,32*1024*1024)
    WORK.mkdir(exist_ok=True)
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            parts=pathlib.PurePosixPath(member.name).parts[1:]
            if not parts:continue
            if member.issym() or member.islnk() or '..' in parts or member.name.startswith('/'):raise ValueError('unsafe source archive')
            target=WORK.joinpath(*parts)
            if member.isdir():target.mkdir(parents=True,exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True,exist_ok=True)
                with tar.extractfile(member) as source:target.write_bytes(source.read())
    (MODEL/'LICENSE.whisper-cpp.txt').write_bytes((WORK/'LICENSE').read_bytes())
    model=download('https://huggingface.co/ggerganov/whisper.cpp/resolve/'+selected['model_revision']+'/ggml-tiny.bin',MODEL/'ggml-tiny.bin',80*1024*1024)
    model_card=download('https://huggingface.co/ggerganov/whisper.cpp/raw/'+selected['model_revision']+'/README.md',MODEL/'MODEL_CARD.md',512*1024)
    with (EVIDENCE/'build.log').open('w') as log:
        for args in [['cmake','-S',str(WORK),'-B',str(WORK/'build'),'-DCMAKE_BUILD_TYPE=Release','-DWHISPER_BUILD_TESTS=OFF','-DWHISPER_BUILD_EXAMPLES=ON','-DGGML_NATIVE=OFF'],
          ['cmake','--build',str(WORK/'build'),'--config','Release','--target','whisper-cli','-j','2']]:
            subprocess.run(args,check=True,stdout=log,stderr=subprocess.STDOUT,timeout=1200)
    binary=WORK/'build/bin/whisper-cli'
    lock={'schema':'dark.asr-source/1','selection':selected,'source_archive':code,'model':model,'model_card':model_card,
      'runtime_binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'runtime_path':str(binary),
      'runtime_distributed':False,'runtime_rebuild_command':'python3 tools/content/asr.py --prepare','native_device':'NOT_RUN'}
    (MODEL/'sources.lock.json').write_text(json.dumps(lock,indent=2)+'\n');print('PREPARED',model['bytes'])

def words(text):return re.findall(r'\w+',text.casefold(),re.UNICODE)
def error_rate(reference,hypothesis):
    a,b=words(reference),words(hypothesis);row=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        nxt=[i]
        for j,y in enumerate(b,1):nxt.append(min(nxt[-1]+1,row[j]+1,row[j-1]+(x!=y)))
        row=nxt
    return row[-1]/max(1,len(a))

def evaluate():
    binary=WORK/'build/bin/whisper-cli'
    lock=json.loads((MODEL/'sources.lock.json').read_text())
    if hashlib.sha256((MODEL/'ggml-tiny.bin').read_bytes()).hexdigest()!=lock['model']['sha256']:raise ValueError('model digest mismatch')
    speech=ROOT/'unity/Assets/HOMELESS/Content/Speech'
    all_entries=json.loads((speech/'speech.json').read_text())['entries']
    probe_acts={'continue_task','offer_ride','refuse_ride','welcome_member','pair_coffee','pair_reply'}
    entries=[e for e in all_entries if e['canonical_act']['act'] in probe_acts];results=[]
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    for entry in entries:
        key=entry['cache_key'];wavepath=EVIDENCE/(key+'-16khz.wav')
        with wave.open(str(speech/entry['filename']),'rb') as f:pcm=f.readframes(f.getnframes());rate=f.getframerate()
        pcm,_=audioop.ratecv(pcm,2,1,rate,16000,None)
        with wave.open(str(wavepath),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(pcm)
        prefix=EVIDENCE/key;started=time.monotonic()
        command=[str(binary),'-m',str(MODEL/'ggml-tiny.bin'),'-f',str(wavepath),'-l',entry['canonical_act']['language'],
          '-t','2','-otxt','-of',str(prefix),'-ng','--no-prints']
        process=subprocess.run(command,capture_output=True,text=True,timeout=90)
        (EVIDENCE/(key+'.log')).write_text(process.stdout+process.stderr)
        if process.returncode:raise ValueError('whisper failed: '+str(process.returncode))
        recognized=prefix.with_suffix('.txt').read_text().strip();elapsed=time.monotonic()-started
        results.append({'event_id':entry['event_id'],'language':entry['canonical_act']['language'],'reference':entry['caption'],
          'recognized':recognized,'word_error_rate':error_rate(entry['caption'],recognized),'wall_seconds':elapsed,
          'audio_seconds':entry['duration_seconds'],'input_sha256':hashlib.sha256(wavepath.read_bytes()).hexdigest(),
          'intent_proposed':None,'world_action_committed':False})
    summary={'schema':'dark.asr-evaluation/1','model':'whisper tiny multilingual GGML','host':'Linux ARM64 CPU, two inference threads',
      'corpus':'12 original synthetic formant-speech lines; no human microphone data','results':results,
      'limitations':['Synthetic fixture does not measure live English/Arabic speech, noise, accents or microphone latency.',
      'Tiny-model output may be wrong. No recognized text executes host or gameplay actions.'],
      'quality_gate':'NOT_PASSED','native_device':'NOT_RUN'}
    (EVIDENCE/'report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'samples':len(results),'mean_wer':sum(x['word_error_rate'] for x in results)/len(results)}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--prepare',action='store_true');args=p.parse_args()
    prepare() if args.prepare else evaluate()
