#!/usr/bin/env python3
"""Bounded licensed SILMA ONNX experiment using only our synthetic reference.

The three-graph input ordering and Euler-loop contract are adapted from phoonnx
F5TTSAdapter, copyright Casimiro Ferreira, Apache-2.0, revision
0e3ee40c5f7cc86254bb152b96f649f21be7ab48. See assets/content/silma/LICENSE.phoonnx.txt.
This compact harness changes loading, limits, source hashing, PCM I/O, evidence
and conditioning policy. No phoonnx voice catalog or human reference is loaded.
"""
import argparse,audioop,hashlib,json,pathlib,shutil,subprocess,sys,time,wave
import asr
ROOT=pathlib.Path(__file__).resolve().parents[2]
CACHE=pathlib.Path('/tmp/homeless-silma-models');ENV=pathlib.Path('/tmp/homeless-silma-python')
OUT=ROOT/'evidence/content/silma';OUT.mkdir(parents=True,exist_ok=True)

def prepare():
    spec=json.loads((ROOT/'assets/content/silma/selection.json').read_text())
    CACHE.mkdir(exist_ok=True);needed=sum(x['bytes'] for x in spec['files'] if not (CACHE/x['file']).exists())
    if shutil.disk_usage(CACHE).free<2*1024**3+needed+210*1024**2:raise RuntimeError('space_reserve: needs model+runtime and2GiB remaining')
    rows=[]
    for row in spec['files']:
        path=CACHE/row['file']
        if not path.exists():asr.download(row['url'],path,row['bytes'])
        observed=hashlib.sha256(path.read_bytes()).hexdigest()
        if path.stat().st_size!=row['bytes'] or row['sha256'] and observed!=row['sha256']:raise ValueError('model source digest mismatch')
        rows.append(dict(row,sha256=observed))
    wheels=pathlib.Path('/tmp/homeless-silma-wheels');wheels.mkdir(exist_ok=True)
    with (OUT/'runtime-install.log').open('w') as log:
        subprocess.run([sys.executable,'-m','pip','download','--no-cache-dir','--only-binary=:all:','--dest',str(wheels),'onnxruntime==1.23.2','numpy==2.2.6'],check=True,stdout=log,stderr=subprocess.STDOUT,timeout=300)
        subprocess.run([sys.executable,'-m','pip','install','--no-index','--find-links',str(wheels),'--target',str(ENV),'onnxruntime==1.23.2','numpy==2.2.6'],check=True,stdout=log,stderr=subprocess.STDOUT,timeout=300)
    packages=[{'filename':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(wheels.glob('*.whl'))]
    (OUT/'sources.lock.json').write_text(json.dumps({'selection':spec,'files':rows,'python_wheels':packages,'cache':str(CACHE),'environment':str(ENV)},indent=2)+'\n')
    print(json.dumps({'model_bytes':sum(x['bytes'] for x in rows),'wheels':len(packages)}))

def infer(act='welcome_member',reference_language='en',unvowelled=False,duration_scale=1.,normalize_reference=False):
    sys.path.insert(0,str(ENV));import numpy as np;import onnxruntime as ort
    lock=json.loads((OUT/'sources.lock.json').read_text())
    for row in lock['files']:
        if hashlib.sha256((CACHE/row['file']).read_bytes()).hexdigest()!=row['sha256']:raise ValueError('model integrity before execution')
    speech=ROOT/'unity/Assets/HOMELESS/Content/Speech';entries=json.loads((speech/'speech.json').read_text())['entries']
    ref=next(e for e in entries if e['canonical_act']['language']==reference_language and e['canonical_act']['act']=='welcome_member')
    target=next(e for e in entries if e['canonical_act']['language']=='ar' and e['canonical_act']['act']==act)
    reference=speech/ref['filename']
    if hashlib.sha256(reference.read_bytes()).hexdigest()!=ref['sha256'] or ref['real_person_voice']:raise ValueError('reference must be verified synthetic fixture')
    with wave.open(str(reference),'rb') as f:pcm=f.readframes(f.getnframes());sr=f.getframerate()
    pcm,_=audioop.ratecv(pcm,2,1,sr,24000,None)
    audio=np.frombuffer(pcm,dtype='<i2').astype(np.float32)/32768
    reference_rms=float(np.sqrt(np.mean(audio*audio)))
    if normalize_reference and 0<reference_rms<.1:audio=audio*(.1/reference_rms)
    if not .5<=duration_scale<=2:raise ValueError('duration scale outside bounded experiment')
    config=json.loads((CACHE/'config.json').read_text());vocab=config['phoneme_id_map']
    from arabic_probe import VOWELS,normalize
    reference_text=ref['caption'].strip()+' ';text=target['caption'] if unvowelled else VOWELS[act]
    if any(c not in vocab for c in reference_text+text):raise ValueError('unknown grapheme, cannot silently replace')
    ref_ids=[vocab[c] for c in reference_text];target_ids=[vocab[c] for c in text]
    session_options=ort.SessionOptions();session_options.intra_op_num_threads=2;session_options.inter_op_num_threads=1
    session_options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    ort.set_seed(85391);started=time.monotonic()
    pre=ort.InferenceSession(str(CACHE/'F5_Preprocess.onnx'),sess_options=session_options,providers=['CPUExecutionProvider'])
    model=ort.InferenceSession(str(CACHE/'model.onnx'),sess_options=session_options,providers=['CPUExecutionProvider'])
    decoder=ort.InferenceSession(str(CACHE/'F5_Decode.onnx'),sess_options=session_options,providers=['CPUExecutionProvider'])
    frames=audio.size//256+1;duration=frames+int(frames/max(len(ref_ids),1)*len(target_ids)*duration_scale)
    if duration>1600:raise ValueError('bounded output duration')
    feed=audio.reshape(1,1,-1)
    if 'int16' in pre.get_inputs()[0].type:feed=np.clip(feed*32767,-32768,32767).astype(np.int16)
    else:feed=feed.astype(np.float32)
    values=pre.run(None,{'audio':feed,'text_ids':np.asarray([ref_ids+target_ids],dtype=np.int32),'max_duration':np.array([duration],dtype=np.int64)})
    noise,*conditioning,ref_signal_len=values
    names=[x.name for x in model.get_inputs()];step=np.array([0],dtype=np.int32)
    for i in range(31):
        noise,step=model.run(None,dict(zip(names,[noise]+conditioning+[step])))
        print(json.dumps({'act':act,'step':i+1,'elapsed_seconds':time.monotonic()-started}),flush=True)
    generated=decoder.run(None,{'denoised':noise,'ref_signal_len':ref_signal_len})[0].reshape(-1)
    if generated.dtype!=np.int16:generated=np.clip(generated*32767,-32768,32767).astype('<i2')
    else:generated=generated.astype('<i2')
    if generated.size==0 or generated.size>24000*30:raise ValueError('output audio bounds')
    stem=act+'-ref-'+reference_language+('-unvowelled' if unvowelled else '')
    if duration_scale!=1:stem+='-duration'+str(duration_scale).replace('.','p')
    if normalize_reference:stem+='-rms'
    output=OUT/(stem+'.wav')
    with wave.open(str(output),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(24000);f.writeframes(generated.tobytes())
    elapsed=time.monotonic()-started
    # Independent recognition of the produced bytes; no generated transcript becomes an action.
    sixteen=OUT/(stem+'-16k.wav');p16,_=audioop.ratecv(generated.tobytes(),2,1,24000,16000,None)
    with wave.open(str(sixteen),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(p16)
    prefix=OUT/(stem+'-asr')
    p=subprocess.run([str(asr.WORK/'build/bin/whisper-cli'),'-m',str(ROOT/'assets/content/asr/ggml-base-q5_1.bin'),'-f',str(sixteen),'-l','ar','-t','2','-otxt','-of',str(prefix),'-ng','--no-prints'],capture_output=True,text=True,timeout=120)
    prefix.with_suffix('.log').write_text(p.stdout+p.stderr)
    if p.returncode:raise ValueError('recognition probe failed')
    recognized=prefix.with_suffix('.txt').read_text().strip()
    report={'schema':'dark.neural-speech-probe/1','model':'SILMA independent bilingual pretrain, licensed Apache-2.0 ONNX export',
      'caption':target['caption'],'spoken_text':text,'act':act,'reference_caption':ref['caption'],'reference_sha256':ref['sha256'],
      'reference_kind':'original formant synthetic voice; no real person','voice_imitation_requested':False,'language':'ar','sample_rate':24000,
      'audio_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'audio_seconds':generated.size/24000,'synthesis_seconds':elapsed,
      'duration_scale':duration_scale,'reference_rms_before':reference_rms,'normalize_reference_to_point_one':normalize_reference,
      'recognized':recognized,'normalized_wer':asr.error_rate(normalize(target['caption']),normalize(recognized)),
      'human_intelligibility':'NOT_RUN','native_device':'NOT_RUN','public_clip_selection':'experimental_not_automatically_selected',
      'runtime':{'onnxruntime':ort.__version__,'numpy':np.__version__,'provider':'CPUExecutionProvider','threads':2,'seed':85391,'euler_calls':31}}
    output.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--prepare',action='store_true');p.add_argument('--all',action='store_true');p.add_argument('--act',default='welcome_member');p.add_argument('--reference-language',choices=['en','ar'],default='en');p.add_argument('--unvowelled',action='store_true');p.add_argument('--duration-scale',type=float,default=1.);p.add_argument('--normalize-reference',action='store_true');a=p.parse_args()
    if a.prepare:prepare()
    elif a.all:
        if not a.unvowelled:raise ValueError('full library currently requires exact unvowelled canonical captions')
        if a.duration_scale!=1 or a.normalize_reference:raise ValueError('run preprocessing variants individually to retain distinct evidence')
        entries=json.loads((ROOT/'unity/Assets/HOMELESS/Content/Speech/speech.json').read_text())['entries']
        for entry in entries:
            if entry['canonical_act']['language']!='ar':continue
            act=entry['canonical_act']['act'];prior=OUT/(act+'-ref-'+a.reference_language+'-unvowelled.json')
            if prior.exists():
                row=json.loads(prior.read_text());wav=prior.with_suffix('.wav')
                if row['caption']==entry['caption'] and wav.exists() and hashlib.sha256(wav.read_bytes()).hexdigest()==row['audio_sha256']:
                    print(json.dumps({'act':act,'cache_hit':True}),flush=True);continue
            infer(act,a.reference_language,True)
    else:infer(a.act,a.reference_language,a.unvowelled,a.duration_scale,a.normalize_reference)
