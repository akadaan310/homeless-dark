"""Select exact-caption neural fixtures using a conservative ASR diagnostic threshold.

The threshold is an automated diagnostic only, never a human intelligibility,
naturalness, or native audio acceptance. Original formant clips remain on disk.
"""
import hashlib,json,pathlib,shutil
import speech
ROOT=pathlib.Path(__file__).resolve().parents[2]
def promoted(base,report,wav,source_lock):
    if report['caption']!=base['caption'] or report['spoken_text']!=base['caption']:raise ValueError('caption mismatch')
    if report['act']!=base['canonical_act']['act'] or report['language']!=base['canonical_act']['language']:raise ValueError('act mismatch')
    if report['voice_imitation_requested'] is not False or report['reference_kind']!='original formant synthetic voice; no real person':raise ValueError('reference provenance')
    if not 0<=report['normalized_wer']<=.25:raise ValueError('ASR diagnostic threshold not met')
    content=wav.read_bytes();digest=hashlib.sha256(content).hexdigest()
    if digest!=report['audio_sha256']:raise ValueError('audio integrity')
    info=speech.pcm_info(wav)
    if info['duration_seconds']>30 or info['pcm_rms']<.001:raise ValueError('silent or oversized audio')
    voice={'runtime':'onnxruntime '+report['runtime']['onnxruntime'],'model':'SILMA TTS v1 licensed Apache-2.0 ONNX export',
      'authoring_only':True,'source_lock_sha256':hashlib.sha256(source_lock.read_bytes()).hexdigest(),
      'reference_sha256':report['reference_sha256'],'reference_kind':report['reference_kind'],'parameters':report['runtime']}
    identity={'schema':'dark.neural-cache/1','act':base['canonical_act'],'caption':base['caption'],'voice':voice,'audio_sha256':digest}
    key=hashlib.sha256(json.dumps(identity,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    return dict(base,cache_key=key,filename=key+'.wav',voice=voice,sha256=digest,**info,
      synthesis_seconds=report['synthesis_seconds'],cache_hit=False,
      formant_fallback_filename=base.get('formant_fallback_filename',base['filename']),
      automated_asr={'model':'whisper.cpp base-q5_1','normalized_wer':report['normalized_wer'],'recognized':report['recognized'],
       'selection_threshold':.25,'human_quality_acceptance':False},native_audition='NOT_RUN',human_intelligibility_review='NOT_RUN')
def main():
    folder=ROOT/'unity/Assets/HOMELESS/Content/Speech';path=folder/'speech.json';manifest=json.loads(path.read_text())
    evidence=ROOT/'evidence/content/silma';lock=evidence/'sources.lock.json';selected=[];rejected=[]
    for index,entry in enumerate(manifest['entries']):
        if entry['canonical_act']['language']!='ar':continue
        act=entry['canonical_act']['act'];report_path=evidence/(act+'-ref-en-unvowelled.json')
        if not report_path.exists():rejected.append({'act':act,'reason':'not generated'});continue
        report=json.loads(report_path.read_text());wav=report_path.with_suffix('.wav')
        try:row=promoted(entry,report,wav,lock)
        except ValueError as exc:rejected.append({'act':act,'reason':str(exc)});continue
        target=folder/row['filename'];shutil.copyfile(wav,target);(folder/(row['cache_key']+'.json')).write_text(json.dumps(row,ensure_ascii=False,indent=2)+'\n')
        for p in (target,folder/(row['cache_key']+'.json')):
            guid=hashlib.sha256(('homeless-source-v1:'+str(p.relative_to(ROOT))).encode()).hexdigest()[:32]
            p.with_name(p.name+'.meta').write_text('fileFormatVersion: 2\nguid: '+guid+'\n')
        manifest['entries'][index]=row;selected.append({'act':act,'normalized_wer':report['normalized_wer'],'filename':row['filename']})
    manifest['voice_model']='Formant synthetic fallback plus individually measured SILMA neural clips; no real-person reference voice.'
    manifest['quality']='Automated ASR diagnostics select individual clips only; human intelligibility, naturalness and native spatial audio acceptance remain NOT_RUN.'
    manifest['authoring_licenses']={'espeak_ng':'GPL-3.0-or-later separate executable','silma_onnx_weights':'Apache-2.0','onnxruntime':'MIT'}
    path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');(ROOT/'evidence/content/speech.json').write_text(path.read_text())
    result={'schema':'dark.neural-clip-selection/1','selected':selected,'rejected':rejected,'human_acceptance':False}
    (evidence/'selection-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
