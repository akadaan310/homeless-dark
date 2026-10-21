"""Check seated joint direction and armature-space root translation in actual master."""
import bpy,json,pathlib,math,hashlib
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/content/authored/CitizenSource.blend'))
rig=bpy.data.objects['CitizenRig'];result={'schema':'dark.seated-source/1','native_contact_acceptance':False,'poses':{},
 'source_sha256':hashlib.sha256((ROOT/'assets/content/authored/CitizenSource.blend').read_bytes()).hexdigest()}
for action,frame in [('Idle',1),('Seated',1),('EnterVehicle',46)]:
    rig.animation_data.action=bpy.data.actions[action];bpy.context.scene.frame_set(frame)
    points={n:list(rig.pose.bones[n].head) for n in ['root','pelvis.L','pelvis.R','upperleg01.L','upperleg01.R','lowerleg01.L','lowerleg01.R','foot.L','foot.R']}
    result['poses'][action]=points
    if action!='Idle':
        delta=rig.pose.bones['root'].head-rig.data.bones['root'].head_local
        assert abs(delta.x)<1e-5 and abs(delta.y)<1e-5 and abs(delta.z+.38)<1e-5,(action,'root vertical drop',tuple(delta))
        for side in ('L','R'):
            hip=Vector(points['upperleg01.'+side]);knee=Vector(points['lowerleg01.'+side])
            assert knee.y<hip.y-.15,(action,'knee must face source -Y',side,tuple(hip),tuple(knee))
result['binding']={'hip_joints':['upperleg01.L','upperleg01.R'],'hip_position':'average joint head after Animator pose evaluation',
 'seat_contact_bone':None,'provisional_hip_above_cushion_m':.09,'status':'source joint proxy only; native cushion, thigh, foot and steering contacts require measurement',
 'axes':{'blender_up':'+Z','blender_front':'-Y','fbx_export_forward':'-Z','fbx_export_up':'Y','unity_axis_import':'NOT_RUN'}}
(ROOT/'evidence/content/seated-source.json').write_text(json.dumps(result,indent=2)+'\n')
rig.animation_data.action=bpy.data.actions['Seated'];bpy.context.scene.frame_set(1)
scene=bpy.context.scene;bpy.ops.object.camera_add(location=(3,-2,1.3));cam=bpy.context.object
cam.rotation_euler=(Vector((0,-.15,.8))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=1.8;scene.camera=cam
scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='TEXTURE';scene.display.shading.show_cavity=True
scene.render.resolution_x=800;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'evidence/content/character-seated-source-preview.png')
bpy.ops.render.render(write_still=True)
print(json.dumps({'result':'PASS','poses':3,'actual_seated_root':result['poses']['Seated']['root']}))
