"""Round-trip generated FBX through Blender in isolated temporary directories.
An independent importer exercises actual bytes; Unity import remains separate.
"""
import bpy,pathlib,tempfile,shutil,json,math,hashlib,sys
from mathutils import Vector
from bpy_extras import node_shader_utils
# The packaged ARM Blender was built without OpenColorIO. Its FBX importer
# requests a missing Non-Color enum. Linear is its available data-map equivalent;
# this local constructor shim does not alter geometry, animation or source files.
original_texture_init=node_shader_utils.ShaderImageTextureWrapper.__init__
def texture_init(self,*args,**kwargs):
    if not bpy.app.build_options.opencolorio and kwargs.get('colorspace_name')=='Non-Color':kwargs['colorspace_name']='Linear'
    original_texture_init(self,*args,**kwargs)
node_shader_utils.ShaderImageTextureWrapper.__init__=texture_init
ROOT=pathlib.Path(__file__).resolve().parents[2]
files=sorted((ROOT/'unity/Assets/HOMELESS/Content').rglob('*.fbx'));records=[]
selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
for path in files:
    if selected and path.stem not in selected:continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with tempfile.TemporaryDirectory() as temp:
        copied=pathlib.Path(temp)/path.name;shutil.copyfile(path,copied)
        bpy.ops.import_scene.fbx(filepath=str(copied),use_anim=True)
        objects=list(bpy.context.scene.objects);meshes=[o for o in objects if o.type=='MESH'];rigs=[o for o in objects if o.type=='ARMATURE']
        if not meshes:raise AssertionError('FBX has no meshes '+path.name)
        bounds=[];unweighted=0;bad_weights=0
        for obj in meshes:
            for v in obj.data.vertices:
                point=obj.matrix_world@v.co
                if not all(math.isfinite(x) for x in point):raise AssertionError('non-finite FBX vertex')
                bounds.append(point)
                if rigs:
                    total=sum(g.weight for g in v.groups)
                    unweighted+=total==0;bad_weights+=abs(total-1)>.002
        if rigs and (unweighted or bad_weights):raise AssertionError(('skin weights invalid',unweighted,bad_weights))
        names={o.name for o in objects};actions=[a.name for a in bpy.data.actions]
        if path.name.startswith('Citizen'):
            if len(rigs)!=1 or len(rigs[0].data.bones)!=163:raise AssertionError('rig bone loss')
            for name in ['Idle','WalkInPlace','JogInPlace','Wave','Talk','Listen','Seated','EnterVehicle']:
                if not any(name in a for a in actions):raise AssertionError('missing motion '+name)
            if not any(o.name.startswith('Shoes') for o in meshes):raise AssertionError('missing shoes')
        if path.name=='CivicSedan.fbx':
            for name in ['LeftFrontDoor','RightFrontDoor','LeftRearDoor','RightRearDoor','LeftFrontWheel','RightFrontWheel','LeftRearWheel','RightRearWheel','SteeringWheel']:
                if name not in names:raise AssertionError('missing vehicle pivot '+name)
        if path.name=='Bicycle.fbx':
            for name in ('FrontWheel','RearWheel','Crank','RiderSeat','LeftHandGrip','RightHandGrip'):
                if name not in names:raise AssertionError('missing bicycle attachment '+name)
            if not actions:raise AssertionError('missing bicycle motion')
        if path.name=='RotorShuttle.fbx':
            for name in ('MainRotor','TailRotor','LeftCabinDoor','RightCabinDoor','PilotSeat','BoardingPoint'):
                if name not in names:raise AssertionError('missing rotor-shuttle attachment '+name)
            if not actions:raise AssertionError('missing rotor/door motion')
        motion_witness={}
        moving={'Bicycle.fbx':('FrontWheel','RearWheel','Crank'),'RotorShuttle.fbx':('MainRotor','TailRotor','LeftCabinDoor','RightCabinDoor')}.get(path.name,())
        for name in moving:
            obj=bpy.data.objects[name];bpy.context.scene.frame_set(1);before=obj.matrix_world.copy()
            bpy.context.scene.frame_set(31);after=obj.matrix_world.copy()
            rotation=before.to_quaternion().rotation_difference(after.to_quaternion()).angle
            translation=(before.translation-after.translation).length
            if rotation<.4 or translation>.0001:raise AssertionError('FBX pivot rotation missing or drifting '+name)
            motion_witness[name]={'frame1_to31_rotation_radians':rotation,'pivot_translation_m':translation}
        bpy.context.scene.frame_set(1)
        hollow_base=None
        if path.name=='CeramicCup.fbx':
            body=next(o for o in meshes if o.name.startswith('ContinuousHollowCup'))
            inv=body.matrix_world.inverted()
            hit,position,_,_=body.ray_cast(inv@Vector((0,0,.2)),inv.to_3x3()@Vector((0,0,-1)))
            if not hit:raise AssertionError('cup has no inner base')
            hollow_base=(body.matrix_world@position).z
            if not .009<hollow_base<.015:raise AssertionError('cup opening is blocked or base absent')
        record={'path':str(path.relative_to(ROOT)),'importer':'Blender FBX 3.0.1','meshes':len(meshes),
          'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
          'environment_shim':'Non-Color to Linear enum only; ARM build lacks OpenColorIO',
          'bones':sum(len(r.data.bones) for r in rigs),'actions':actions,'images':len(bpy.data.images),
          'unweighted_vertices':unweighted,'non_normalized_weights':bad_weights,
          'bounds_m':[[min(v[i] for v in bounds),max(v[i] for v in bounds)] for i in range(3)],'result':'PASS',
          'native_unity_import':'NOT_RUN','cup_inner_base_hit_m':hollow_base,'mechanical_motion':motion_witness}
        if max(record['bounds_m'][2])-min(record['bounds_m'][2])>30:raise AssertionError('unexpected FBX scale')
        records.append(record)
if selected:
    prior=json.loads((ROOT/'evidence/content/fbx-roundtrip.json').read_text())['files']
    records.extend(row for row in prior if pathlib.Path(row['path']).stem not in selected)
(ROOT/'evidence/content/fbx-roundtrip.json').write_text(json.dumps({'schema':'dark.fbx-validation/1','files':records},indent=2)+'\n')
print(json.dumps({'files':len(records),'passed':len(records)}))
