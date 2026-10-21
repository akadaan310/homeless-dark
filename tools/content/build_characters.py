"""Blender 3.0+ batch: CC0 MakeHuman rig/skin, dressed variants, original motion.
Run: blender -b --python tools/content/build_characters.py
This source-art preparation does not assert Unity retarget or visual acceptance.
"""
import bpy, json, pathlib, math, hashlib
from mathutils import Vector, Quaternion
ROOT=pathlib.Path(__file__).resolve().parents[2]
SRC=ROOT/'assets/content/makehuman'
OUT=ROOT/'unity/Assets/HOMELESS/Content/Characters'
OUT.mkdir(parents=True,exist_ok=True)
MASTER=ROOT/'assets/content/authored';MASTER.mkdir(parents=True,exist_ok=True)

def parse_obj(path, body_only=False):
    vertices=[];uvs=[];faces=[];uv_faces=[];group=''
    for line in path.read_text().splitlines():
        p=line.split()
        if not p:continue
        if p[0]=='v':vertices.append(tuple(map(float,p[1:4])))
        elif p[0]=='vt':uvs.append(tuple(map(float,p[1:3])))
        elif p[0]=='g':group=p[1]
        elif p[0]=='f' and (not body_only or group=='body'):
            fields=[v.split('/') for v in p[1:]]
            faces.append([int(v[0])-1 for v in fields])
            uv_faces.append([int(v[1])-1 if len(v)>1 and v[1] else -1 for v in fields])
    return vertices,uvs,faces,uv_faces

raw,uvs,faces,uv_faces=parse_obj(SRC/'makehuman/data/3dobjs/base.obj',True)
floor=min(raw[v][1] for f in faces for v in f)
def convert(v):return Vector((v[0]*.1,-v[2]*.1,(v[1]-floor)*.1))
verts=[convert(v) for v in raw]
weights=json.loads((SRC/'makehuman/data/rigs/default_weights.mhw').read_text())['weights']
by_vertex={}
for bone,items in weights.items():
    for index,w in items:by_vertex.setdefault(index,{})[bone]=w
rigspec=json.loads((SRC/'makehuman/data/rigs/default.mhskel').read_text())

def material(name,tex,roughness=.6,alpha=False):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=roughness
    n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=bpy.data.images.load(str(tex),check_existing=True)
    m.node_tree.links.new(n.outputs['Color'],p.inputs['Base Color'])
    normal=tex.with_name(tex.name.replace('_diffuse','_normal'))
    if normal!=tex and normal.exists():
        image=m.node_tree.nodes.new('ShaderNodeTexImage');image.image=bpy.data.images.load(str(normal),check_existing=True)
        try:image.image.colorspace_settings.name='Non-Color'
        except TypeError:image.image.colorspace_settings.name='Linear'
        mapper=m.node_tree.nodes.new('ShaderNodeNormalMap');m.node_tree.links.new(image.outputs['Color'],mapper.inputs['Color']);m.node_tree.links.new(mapper.outputs['Normal'],p.inputs['Normal'])
    if alpha:
        m.node_tree.links.new(n.outputs['Alpha'],p.inputs['Alpha']);m.blend_method='CLIP';m.use_screen_refraction=False
    return m

def mesh(name,v,uv,f,uf,mat):
    # Retain a source-index map while removing unused helper vertices.
    used=sorted({i for face in f for i in face});remap={v:i for i,v in enumerate(used)}
    data=bpy.data.meshes.new(name);data.from_pydata([v[i] for i in used],[],[[remap[i] for i in face] for face in f]);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.data.materials.append(mat)
    layer=data.uv_layers.new(name='UVMap')
    for poly,uvface in zip(data.polygons,uf):
        poly.use_smooth=True
        for li,ui in zip(poly.loop_indices,uvface):layer.data[li].uv=uv[ui] if ui>=0 else (0,0)
    return obj,used

def bind(obj,rig,mapped_weights):
    for bone in rig.data.bones:obj.vertex_groups.new(name=bone.name)
    for vertex,items in enumerate(mapped_weights):
        valid={b:w for b,w in items.items() if b in rig.data.bones and w>0}
        # Bound to four influences for the prospective mobile profile.
        valid=dict(sorted(valid.items(),key=lambda item:(-item[1],item[0]))[:4]);total=sum(valid.values())
        if not total:valid={'root':1};total=1
        for bone,w in valid.items():obj.vertex_groups[bone].add([vertex],w/total,'REPLACE')
    obj.parent=rig
    modifier=obj.modifiers.new('Skin','ARMATURE');modifier.object=rig

def clothing_weights(path):
    result=[];active=False
    for line in path.read_text().splitlines():
        p=line.split()
        if not p or p[0].startswith('#'):continue
        if p[0]=='verts':active=True;continue
        if not active:continue
        try:
            if len(p)==1:pairs=[(int(p[0]),1.)]
            elif len(p)>=6:pairs=list(zip(map(int,p[:3]),map(float,p[3:6])))
            else:break
        except ValueError:break
        value={}
        for index,factor in pairs:
            for bone,w in by_vertex.get(index,{}).items():value[bone]=value.get(bone,0)+w*factor
        result.append(value)
    return result

def fitted_coordinates(path):
    scale=[1.,1.,1.];active=False;result=[]
    for line in path.read_text().splitlines():
        p=line.split()
        if not p or p[0].startswith('#'):continue
        if p[0] in ('x_scale','y_scale','z_scale'):
            axis=('x_scale','y_scale','z_scale').index(p[0]);a,b=int(p[1]),int(p[2]);den=float(p[3])
            scale[axis]=abs(raw[a][axis]-raw[b][axis])/den
        if p[0]=='verts':active=True;continue
        if not active:continue
        try:
            if len(p)==1:v=raw[int(p[0])]
            elif len(p)>=9:
                ids=list(map(int,p[:3]));weights=list(map(float,p[3:6]));offset=list(map(float,p[6:9]))
                v=[sum(raw[index][axis]*weight for index,weight in zip(ids,weights))+offset[axis]*scale[axis] for axis in range(3)]
            else:break
        except ValueError:break
        result.append(convert(v))
    return result

def build_rig():
    arm=bpy.data.armatures.new('MakeHuman_Default_163');rig=bpy.data.objects.new('CitizenRig',arm);bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    joints={name:sum((verts[i] for i in indices),Vector())/len(indices) for name,indices in rigspec['joints'].items()}
    for name,spec in rigspec['bones'].items():
        b=arm.edit_bones.new(name);b.head=joints[spec['head']];b.tail=joints[spec['tail']]
        if (b.tail-b.head).length<.00001:b.tail=b.head+Vector((0,0,.001))
        plane=rigspec['planes'].get(spec.get('rotation_plane'))
        if plane:
            a,c,d=[joints[x] for x in plane];normal=(c-a).cross(d-a)
            if normal.length>.00001:b.align_roll(normal)
    for name,spec in rigspec['bones'].items():
        if spec.get('parent'):arm.edit_bones[name].parent=arm.edit_bones[spec['parent']]
    bpy.ops.object.mode_set(mode='OBJECT');return rig

def pose(rig,name,deg,axis=(1,0,0)):
    bone=rig.pose.bones[name];rest=rig.data.bones[name].matrix_local.to_quaternion()
    bone.rotation_mode='QUATERNION';bone.rotation_quaternion=rest.inverted()@Quaternion(axis,math.radians(deg))@rest

def animate(rig):
    rig.animation_data_create();clips=[]
    actions=[('Idle',60),('WalkInPlace',30),('JogInPlace',24),('Wave',60),('Talk',60),('Listen',60),('Seated',30),('EnterVehicle',60)]
    for name,length in actions:
        action=bpy.data.actions.new(name);action.use_fake_user=True;rig.animation_data.action=action
        for frame in range(1,length+2):
            phase=2*math.pi*(frame-1)/length
            for b in rig.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion();b.location=(0,0,0)
            pose(rig,'upperarm01.L',35,(0,1,0));pose(rig,'upperarm01.R',-35,(0,1,0))
            pose(rig,'spine02',math.sin(phase)*.8)
            if name in ('WalkInPlace','JogInPlace'):
                amp=25 if name=='WalkInPlace' else 40
                for side,offset in [('L',0),('R',math.pi)]:
                    s=math.sin(phase+offset)
                    pose(rig,'upperleg01.'+side,amp*s);pose(rig,'lowerleg01.'+side,-max(0,-s)*(35 if amp==25 else 70))
                    pose(rig,'foot.'+side,-s*8);pose(rig,'lowerarm01.'+side,-25 if amp==25 else -60)
                    pose(rig,'upperarm01.'+side,35 if side=='L' else -35,(0,1,0))
                    rig.pose.bones['upperarm01.'+side].rotation_quaternion @= Quaternion((1,0,0),math.radians(-s*15))
            if name=='Wave':
                pose(rig,'upperarm01.R',25,(0,1,0));pose(rig,'lowerarm01.R',-115);pose(rig,'wrist.R',20*math.sin(phase*3),(0,1,0))
            if name=='Talk':pose(rig,'jaw',2+2*math.sin(phase*5));pose(rig,'lowerarm01.L',-45+10*math.sin(phase));pose(rig,'head',math.sin(phase)*3,(0,0,1))
            if name=='Listen':pose(rig,'head',3*math.sin(phase));pose(rig,'neck01',-5,(0,0,1))
            if name in ('Seated','EnterVehicle'):
                t=1 if name=='Seated' else min(1,(frame-1)/45)
                for side in ('L','R'):pose(rig,'upperleg01.'+side,-80*t);pose(rig,'lowerleg01.'+side,85*t);pose(rig,'lowerarm01.'+side,-65*t)
                # Pose translations are bone-local: convert the intended armature
                # vertical drop explicitly, otherwise this rig moves sideways.
                rig.pose.bones['root'].location=rig.data.bones['root'].matrix_local.to_3x3().inverted()@Vector((0,0,-.38*t))
            for bone in rig.pose.bones:bone.keyframe_insert('rotation_quaternion',frame=frame);bone.keyframe_insert('location',frame=frame)
        for curve in action.fcurves:
            for key in curve.keyframe_points:key.interpolation='LINEAR'
        clips.append({'name':name,'frames':[1,length+1],'fps':30,'duration_seconds':length/30,'loop':name!='EnterVehicle',
          'root_motion':'in_place_except_seated_pelvis_offset','source':'original authored deterministic keyframes',
          'contact_markers':{'left_heel_phase':0,'right_heel_phase':.5} if name in ('WalkInPlace','JogInPlace') else {},
          'foot_contact_native_verified':False,'retarget_native_verified':False})
    rig.animation_data.action=bpy.data.actions.get('Idle');bpy.context.scene.frame_set(1);return clips

def main():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    rig=build_rig()
    skin=material('Citizen_Skin',SRC/'system/skins/young_caucasian_male/young_lightskinned_male_diffuse.png',.55)
    # Remove source-designated hidden body faces beneath clothing, preserving masters.
    masked=set()
    for rel in ['clothes/male_casualsuit01/male_casualsuit01.mhclo','clothes/shoes01/shoes01.mhclo']:
        text=(SRC/'system'/rel).read_text()
        if 'delete_verts' in text:
            words=text.split('delete_verts',1)[1].split();i=0
            while i<len(words):
                if not words[i].isdigit():break
                start=int(words[i]);i+=1
                if i+1<len(words) and words[i]=='-':masked.update(range(start,int(words[i+1])+1));i+=2
                else:masked.add(start)
    visible=[i for i,f in enumerate(faces) if not all(v in masked for v in f)]
    obj,used=mesh('CitizenBody',verts,uvs,[faces[i] for i in visible],[uv_faces[i] for i in visible],skin);bind(obj,rig,[by_vertex.get(i,{}) for i in used])
    assets=[('Outfit','clothes/male_casualsuit01','male_casualsuit01','male_casualsuit01_diffuse.png',False),
      ('Hair','hair/short01','short01','short01_diffuse.png',True),('Eyes','eyes/high-poly','high-poly','../materials/brown_eye.png',False),
      ('Shoes','clothes/shoes01','shoes01','shoes01_diffuse.png',False),
      ('Teeth','teeth/teeth_base','teeth_base','teeth.png',False),('Tongue','tongue/tongue01','tongue01','tongue01_diffuse.png',False)]
    for name,folder,stem,texture,alpha in assets:
        folder=SRC/'system'/folder;v,uv,f,uf=parse_obj(folder/(stem+'.obj'))
        mat=material(name+'_Material',folder/texture,.65,alpha)
        fitted=fitted_coordinates(folder/(stem+'.mhclo'))
        if len(fitted)!=len(v):raise ValueError((name,'MHCLO coordinate count',len(fitted),len(v)))
        o,ids=mesh(name,fitted,uv,f,uf,mat)
        mapped=clothing_weights(folder/(stem+'.mhclo'))
        if len(mapped)!=len(v):raise ValueError((name,'MHCLO vertex count',len(mapped),len(v)))
        bind(o,rig,[mapped[i] for i in ids])
    clips=animate(rig);scene=bpy.context.scene;scene.render.fps=30;scene.frame_start=1;scene.frame_end=61
    # Export source masters and embedded texture FBX; importer material adaptation remains explicit.
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(MASTER/'CitizenSource.blend'),compress=True)
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_as_mainfile(filepath=str(MASTER/'CitizenSource.blend'),compress=True)
    bpy.ops.export_scene.fbx(filepath=str(OUT/'Citizen.fbx'),use_selection=True,object_types={'ARMATURE','MESH'},
      add_leaf_bones=False,bake_anim=True,bake_anim_use_all_actions=True,bake_anim_use_nla_strips=False,
      path_mode='COPY',embed_textures=True,axis_forward='-Z',axis_up='Y',use_mesh_modifiers=True)
    # Variant shares the licensed rig/outfit while retaining a second full-resolution source skin.
    material_node=next(n for n in skin.node_tree.nodes if n.type=='TEX_IMAGE')
    material_node.image=bpy.data.images.load(str(SRC/'system/skins/middleage_african_male/middleage_darkskinned_male_diffuse.png'),check_existing=True)
    bpy.ops.export_scene.fbx(filepath=str(OUT/'CitizenAltSkin.fbx'),use_selection=True,object_types={'ARMATURE','MESH'},
      add_leaf_bones=False,bake_anim=True,bake_anim_use_all_actions=True,bake_anim_use_nla_strips=False,
      path_mode='COPY',embed_textures=True,axis_forward='-Z',axis_up='Y')
    report={'schema':'homeless.character-content/1','license':'CC0-1.0','rig_bones':len(rig.data.bones),
      'meshes':[{'name':o.name,'vertices':len(o.data.vertices),'triangles':sum(len(p.vertices)-2 for p in o.data.polygons)} for o in scene.objects if o.type=='MESH'],
      'clips':clips,'source_height_m':max(v.z for v in verts[:13380])-min(v.z for v in verts[:13380]),
      'source_only':True,'native_import':'NOT_RUN','close_up_cinematic_gate':'NOT_RUN',
      'limitations':['Two skin variants share topology, outfit and original keyframe motions; not a complete diverse appearance library.',
      'Original keyframe motion has not passed native foot contacts, stairs, vehicle alignment, retarget or facial quality review.',
      'Skin uses source diffuse; no claimed measured skin scattering or mobile shader calibration.']}
    (OUT/'character.json').write_text(json.dumps(report,indent=2)+'\n')
    (ROOT/'evidence/content/characters.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'bones':len(rig.data.bones),'clips':len(clips),'meshes':len(report['meshes'])}))

if __name__=='__main__':main()
