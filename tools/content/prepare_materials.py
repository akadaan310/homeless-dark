#!/usr/bin/env python3
"""Copy unchanged licensed texture masters into explicit Unity-readable paths."""
import pathlib,json,shutil,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2];SRC=ROOT/'assets/content/makehuman/system'
OUT=ROOT/'unity/Assets/HOMELESS/Content/Characters/Textures';OUT.mkdir(exist_ok=True)
bindings=[
 ('Citizen_Skin','skins/young_caucasian_male/young_lightskinned_male_diffuse.png',None,False),
 ('Citizen_Skin_Alternate','skins/middleage_african_male/middleage_darkskinned_male_diffuse.png',None,False),
 ('Outfit_Material','clothes/male_casualsuit01/male_casualsuit01_diffuse.png','clothes/male_casualsuit01/male_casualsuit01_normal.png',False),
 ('Hair_Material','hair/short01/short01_diffuse.png',None,True),
 ('Eyes_Material','eyes/materials/brown_eye.png',None,False),
 ('Shoes_Material','clothes/shoes01/shoes01_diffuse.png','clothes/shoes01/shoes01_normal.png',False),
 ('Teeth_Material','teeth/teeth_base/teeth.png',None,False),
 ('Tongue_Material','tongue/tongue01/tongue01_diffuse.png',None,False)]
result=[]
for material,diffuse,normal,alpha in bindings:
    row={'material':material,'shader':'Universal Render Pipeline/Lit','alpha_clip':alpha,'cutoff':.45 if alpha else 0,
      'normal_space':'OpenGL tangent-space source, native importer inspection required','smoothness':.30 if material=='Eyes_Material' else .18}
    for kind,name in [('diffuse',diffuse),('normal',normal)]:
        if not name:continue
        source=SRC/name;target=OUT/source.name;shutil.copyfile(source,target)
        row[kind]={'path':str(target.relative_to(ROOT/'unity')),'source':str(source.relative_to(ROOT)),
          'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'srgb':kind=='diffuse'}
    result.append(row)
manifest={'schema':'dark.character-material-bindings/1','bindings':result,
 'variant_binding':'CitizenAltSkin.fbx material Citizen_Skin uses Citizen_Skin_Alternate diffuse override.',
 'native_import':'NOT_RUN','source_resolution_preserved':True}
(OUT.parent/'materials.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'materials':len(result),'files':len(list(OUT.glob('*.png')))}))
