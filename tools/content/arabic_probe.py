#!/usr/bin/env python3
"""Controlled Arabic pronunciation/ASR experiment, retaining all failures.
Compare unchanged captions, fully vowelled authoring text, and two pinned ASR
models. Synthetic WER does not certify naturalness or live microphone accuracy.
"""
import audioop,hashlib,json,pathlib,subprocess,time,unicodedata,wave
import asr
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'evidence/content/arabic-probe';OUT.mkdir(parents=True,exist_ok=True)
MODEL=ROOT/'assets/content/asr/ggml-base-q5_1.bin'
PIN={'url':'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin',
 'bytes':59707625,'sha256':'422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898','license':'MIT',
 'state':'FREE_SELECTED','purpose':'Compare actual Arabic synthetic-speech recognition; no human voice corpus'}
VOWELS={
 'continue_task':'يَجِبُ أَنْ أُنْهِيَ هَذَا الْعَمَلَ. يُمْكِنُنَا التَّحَدُّثُ لَاحِقًا.',
 'offer_ride':'هَلْ تُرِيدُ الذَّهَابَ إِلَى الْمَقْهَى؟ يُمْكِنُكَ الْإِلْغَاءُ فِي أَيِّ وَقْتٍ.',
 'refuse_ride':'لَا، شُكْرًا. أُفَضِّلُ الْمَشْيَ.',
 'welcome_member':'أَهْلًا بِكَ. خُذْ وَقْتَكَ وَانْظُرْ حَوْلَكَ.',
 'pair_coffee':'تَوَقَّفَ الْمَطَرُ. هَلْ نَجْلِسُ فِي الْخَارِجِ؟',
 'pair_reply':'بَعْدَ قَلِيلٍ. أَنَا أَنْتَظِرُ قَهْوَتِي.'}
def normalize(s):
    s=''.join(c for c in unicodedata.normalize('NFKC',s) if unicodedata.category(c)!='Mn' and c!='ـ')
    return s.translate(str.maketrans({'أ':'ا','إ':'ا','آ':'ا','ى':'ي'}))
def main():
    (ROOT/'assets/content/asr/base-selection.json').write_text(json.dumps(PIN,indent=2)+'\n')
    if not MODEL.exists():asr.download(PIN['url'],MODEL,64*1024*1024)
    if MODEL.stat().st_size!=PIN['bytes'] or hashlib.sha256(MODEL.read_bytes()).hexdigest()!=PIN['sha256']:raise ValueError('pinned base model digest mismatch')
    entries=json.loads((ROOT/'unity/Assets/HOMELESS/Content/Speech/speech.json').read_text())['entries']
    entries=[e for e in entries if e['canonical_act']['language']=='ar' and e['canonical_act']['act'] in VOWELS]
    results=[]
    for entry in entries:
        act=entry['canonical_act']['act'];caption=entry['caption']
        for mode in ['unvowelled','vowelled']:
            if mode=='unvowelled':source=ROOT/'unity/Assets/HOMELESS/Content/Speech'/entry['filename'];spoken=caption
            else:
                source=OUT/(act+'-vowelled.wav');spoken=VOWELS[act]
                subprocess.run(['espeak-ng','-v','ar','-s','140','-p','48','-a','80','-w',str(source),'--stdin'],input=spoken,text=True,check=True,timeout=30)
            wav=OUT/(act+'-'+mode+'-16k.wav')
            with wave.open(str(source),'rb') as f:pcm=f.readframes(f.getnframes());rate=f.getframerate()
            pcm,_=audioop.ratecv(pcm,2,1,rate,16000,None)
            with wave.open(str(wav),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(pcm)
            for model in ['tiny','base-q5_1']:
                path=MODEL if model=='base-q5_1' else MODEL.parent/'ggml-tiny.bin';prefix=OUT/(act+'-'+mode+'-'+model)
                started=time.monotonic();p=subprocess.run([str(asr.WORK/'build/bin/whisper-cli'),'-m',str(path),'-f',str(wav),'-l','ar','-t','2','-otxt','-of',str(prefix),'-ng','--no-prints'],capture_output=True,text=True,timeout=120)
                prefix.with_suffix('.log').write_text(p.stdout+p.stderr)
                if p.returncode:raise ValueError('ASR failed')
                recognized=prefix.with_suffix('.txt').read_text().strip()
                results.append({'act':act,'tts_variant':mode,'model':model,'caption':caption,'spoken_text':spoken,
                 'recognized':recognized,'raw_wer':asr.error_rate(caption,recognized),'normalized_wer':asr.error_rate(normalize(caption),normalize(recognized)),
                 'wall_seconds':time.monotonic()-started,'input_sha256':hashlib.sha256(wav.read_bytes()).hexdigest()})
                (OUT/'partial-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
    means=[]
    for mode in ['unvowelled','vowelled']:
        for model in ['tiny','base-q5_1']:
            r=[x for x in results if x['tts_variant']==mode and x['model']==model]
            means.append({'tts_variant':mode,'model':model,'samples':len(r),'mean_normalized_wer':sum(x['normalized_wer'] for x in r)/len(r),'mean_raw_wer':sum(x['raw_wer'] for x in r)/len(r)})
    report={'schema':'dark.arabic-comparison/1','results':results,'means':means,'base_model':PIN,
     'human_intelligibility':'NOT_RUN','native_device':'NOT_RUN','quality_gate':'NOT_PASSED',
     'scoring':'Whitespace/punctuation WER; normalized score additionally removes Arabic combining marks/tatweel, normalizes alef variants and alef maqsura.',
     'limitations':['Six scripted synthetic lines only. Vowelled condition changes explicit pronunciation and speed155to140; it is a combined intervention, not isolated causal attribution.',
     'A recognizer agreement score is not proof of human intelligibility or voice naturalness.']}
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(means))
if __name__=='__main__':main()
