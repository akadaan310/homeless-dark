#!/usr/bin/env python3
"""Bounded grounded dialogue, real offline formant TTS and an explicit event lifecycle.

The subprocess tool is eSpeak NG, GPL-3.0-or-later, installed separately. No TTS
runtime is linked or embedded into Unity. WAVs are original scripted synthetic
utterances, not imitations or recordings of a person. Audio quality remains a
device/user review gate, separate from decoded PCM and lifecycle tests.
"""
import array, hashlib, json, math, pathlib, re, subprocess, tempfile, time, wave
ROOT=pathlib.Path(__file__).resolve().parents[2]
ENTITIES={'cafe':{'en':'the cafe','ar':'المقهى'},'harbor':{'en':'the harbor','ar':'الميناء'}}
TEMPLATES={
 'continue_task':{'en':'I need to finish this delivery. We can talk later.','ar':'يجب أن أنهي هذا العمل. يمكننا التحدث لاحقا.'},
 'offer_ride':{'en':'Would you like a ride to {destination}? You can cancel at any time.','ar':'هل تريد الذهاب إلى {destination}؟ يمكنك الإلغاء في أي وقت.'},
 'refuse_ride':{'en':'No, thank you. I would rather walk.','ar':'لا، شكرا. أفضل المشي.'},
 'welcome_member':{'en':'Welcome. Take your time and look around.','ar':'أهلا بك. خذ وقتك وانظر حولك.'},
 'pair_coffee':{'en':'The rain has stopped. Shall we sit outside?','ar':'توقف المطر. هل نجلس في الخارج؟'},
 'pair_reply':{'en':'In a moment. I am waiting for my coffee.','ar':'بعد قليل. أنا أنتظر قهوتي.'},
 'greeting':{'en':'Hello. Good to see you.','ar':'مرحبا. تسعدني رؤيتك.'},
 'server_offer_ride':{'en':'I can help arrange a ride. Where are you going?','ar':'يمكنني المساعدة في ترتيب رحلة. إلى أين تذهب؟'},
 'decline_ride':{'en':'I need to get to work. I cannot offer a ride now.','ar':'يجب أن أذهب إلى العمل. لا يمكنني عرض رحلة الآن.'},
 'farewell':{'en':'Take care. See you around.','ar':'اعتن بنفسك. أراك لاحقا.'},
 'describe_work_work':{'en':'I am heading to work.','ar':'أنا في طريقي إلى العمل.'},
 'describe_work_talk':{'en':'I am taking some time to talk.','ar':'أنا أخصص بعض الوقت للحديث.'},
 'work':{'en':'Time to get back to work.','ar':'حان وقت العودة إلى العمل.'},
 'socialize':{'en':'It is good to have some company.','ar':'من الجميل أن تكون مع الآخرين.'},
 'rest':{'en':'I could use a rest.','ar':'أحتاج إلى بعض الراحة.'}}

def realize(act):
    if act.get('act') not in TEMPLATES or act.get('language') not in ('en','ar'):raise ValueError('unsupported grounded act')
    if not re.fullmatch(r'(?:npc|member):[a-z0-9_-]{1,48}',act.get('speaker','')):raise ValueError('invalid speaker')
    slots=act.get('slots',{})
    expected={'destination'} if act['act']=='offer_ride' else set()
    if not isinstance(slots,dict) or set(slots)!=expected:raise ValueError('slot mismatch')
    values={}
    for name,value in slots.items():
        if value not in ENTITIES:raise ValueError('ungrounded entity')
        values[name]=ENTITIES[value][act['language']]
    return TEMPLATES[act['act']][act['language']].format(**values)

def runtime_identity(language):
    version=subprocess.run(['espeak-ng','--version'],check=True,capture_output=True,text=True,timeout=10).stdout.strip()
    # Pin actual phoneme/voice/dictionary input bytes, not just a version label.
    data=pathlib.Path('/usr/lib/aarch64-linux-gnu/espeak-ng-data')
    if not data.exists():
        match=re.search(r'Data at:\s*(.+)',version)
        if not match:raise ValueError('cannot locate voice data')
        data=pathlib.Path(match.group(1))
    names=['phondata','phonindex','phontab','intonations','en_dict' if language=='en' else 'ar_dict',
           'lang/gmw/en-US' if language=='en' else 'lang/sem/ar']
    hashes={}
    for name in names:
        p=data/name
        if not p.is_file():raise ValueError('missing voice input '+str(p))
        hashes[name]=hashlib.sha256(p.read_bytes()).hexdigest()
    return {'runtime':version.split('  Data at:')[0], 'voice':'en-us' if language=='en' else 'ar',
      'speed_words_per_minute':155,'pitch':48,'amplitude':80,'voice_input_sha256':hashes,
      'pronunciation_dictionary':'bundled pinned dictionary; no custom entries','prosody':'fixed command parameters'}

def cache_key(act):
    if not re.fullmatch(r'evt:[a-zA-Z0-9:_-]{1,100}',act.get('event_id','')):raise ValueError('invalid event identity')
    payload={'schema':'dark.speech/1','act':act,'text':realize(act),'voice':runtime_identity(act['language'])}
    return hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def pcm_info(path):
    with wave.open(str(path),'rb') as f:
        if f.getsampwidth()!=2 or f.getnchannels()!=1:raise ValueError('unsupported audio encoding')
        rate=f.getframerate();frames=f.getnframes();samples=array.array('h',f.readframes(frames))
    if not samples or len(samples)!=frames:raise ValueError('empty or incomplete PCM')
    return {'sample_rate':rate,'channels':1,'codec':'PCM16-WAV','frames':frames,'duration_seconds':frames/rate,
      'peak_abs':max(abs(x) for x in samples),'pcm_rms':math.sqrt(sum(x*x for x in samples)/frames)/32768}

def synthesize(act,out):
    out.mkdir(parents=True,exist_ok=True);key=cache_key(act);target=out/(key+'.wav');meta=out/(key+'.json')
    if target.exists() or meta.exists():
        if not(target.is_file() and meta.is_file()):raise ValueError('incomplete cache entry')
        entry=json.loads(meta.read_text())
        if hashlib.sha256(target.read_bytes()).hexdigest()!=entry['sha256'] or entry['cache_key']!=key:raise ValueError('corrupt cache entry')
        pcm_info(target);return dict(entry,cache_hit=True)
    voice=runtime_identity(act['language']);started=time.monotonic()
    with tempfile.TemporaryDirectory(dir=out) as tmp:
        wav=pathlib.Path(tmp)/'speech.wav'
        subprocess.run(['espeak-ng','-v',voice['voice'],'-s','155','-p','48','-a','80','-w',str(wav),'--stdin'],
          input=realize(act),text=True,check=True,capture_output=True,timeout=30)
        info=pcm_info(wav)
        if info['duration_seconds']>30:raise ValueError('speech duration exceeds budget')
        entry={'schema':'dark.speech-cache/1','cache_key':key,'filename':target.name,'event_id':act['event_id'],
          'speaker':act['speaker'],'canonical_act':act,'caption':realize(act),'voice':voice,
          'sha256':hashlib.sha256(wav.read_bytes()).hexdigest(),'synthesis_seconds':time.monotonic()-started,**info,
          'native_audition':'NOT_RUN','human_intelligibility_review':'NOT_RUN','real_person_voice':False}
        wav.replace(target);meta.write_text(json.dumps(entry,ensure_ascii=False,indent=2)+'\n')
    return dict(entry,cache_hit=False)

class Conversation:
    """Presentation scheduling. A commit authorizes an act, not world permissions.
    `playing` means scheduled playback only; no claim of physical audibility.
    """
    def __init__(self):self.states={};self.speakers={};self.events=[]
    def transition(self,event,state,allowed):
        if self.states.get(event) not in allowed:raise ValueError('invalid speech transition')
        self.states[event]=state;self.events.append({'event_id':event,'state':state,'sequence':len(self.events)+1})
    def predict(self,event,speaker):
        self.transition(event,'predicted',(None,));self.speakers[event]=speaker
    def synthesized(self,event):self.transition(event,'synthesized',('predicted',))
    def fetched(self,event):self.transition(event,'fetched',('synthesized',))
    def commit(self,event):self.transition(event,'committed',('fetched',))
    def start(self,event):self.transition(event,'playing',('committed',))
    def finish(self,event):self.transition(event,'finished',('playing',))
    def ignore(self,event):self.transition(event,'ignored',('predicted','synthesized','fetched'))
    def cancel(self,event):self.transition(event,'canceled',('predicted','synthesized','fetched','committed'))
    def interrupt_speaker(self,speaker):
        for event in list(self.states):
            if self.speakers[event]==speaker and self.states[event]=='playing':self.transition(event,'interrupted',('playing',))

def main():
    out=ROOT/'unity/Assets/HOMELESS/Content/Speech';entries=[]
    for language in ('en','ar'):
        for index,name in enumerate(TEMPLATES):
            act={'event_id':'evt:arrival:'+language+':'+name,'speaker':'npc:ana' if index%2==0 else 'npc:bo',
              'language':language,'act':name,'slots':{'destination':'cafe'} if name=='offer_ride' else {}}
            entries.append(synthesize(act,out))
    manifest={'schema':'dark.speech-library/1','entries':entries,
      'server_caption_binding':'Exact caption match only. Runtime event ID and speaker come from committed server event; this is a reusable audio realization.',
      'server_act_variants':{'offer_ride':['server_offer_ride'],'describe_work':['describe_work_work','describe_work_talk']},
      'runtime_license':'GPL-3.0-or-later; separate offline authoring tool, not embedded runtime',
      'voice_model':'formant synthesis; no recorded human voice model','native_spatialization':'NOT_RUN',
      'quality':'Synthetic fallback; English/Arabic intelligibility and naturalness require human/native review.'}
    (out/'speech.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'evidence/content/speech.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'clips':len(entries),'seconds':sum(e['duration_seconds'] for e in entries),'bytes':sum((out/e['filename']).stat().st_size for e in entries)}))

if __name__=='__main__':main()
