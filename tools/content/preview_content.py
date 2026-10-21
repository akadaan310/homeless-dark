"""Workbench source inspection under Xvfb, not Unity/PBR acceptance footage.
Ubuntu ARM Blender's Cycles render returned black and has no OpenColorIO support.
Workbench provides observable geometry/UV inspection, not native lighting proof.
"""
import bpy,pathlib,math,json,sys
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2];EVIDENCE=ROOT/'evidence/content'
selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
def inspect(name,path,camera,target,scale):
    if selected and name not in selected:return
    bpy.ops.wm.open_mainfile(filepath=str(path));scene=bpy.context.scene
    meshes=[o for o in scene.objects if o.type=='MESH'];rig=next((o for o in scene.objects if o.type=='ARMATURE'),None)
    witness={'asset':name,'renderer':'Blender Workbench studio/texture under Xvfb/Mesa','native_unity':False,
      'pbr_lighting_acceptance':False,'frames':[]}
    actions=list(bpy.data.actions) if rig else [None];original=rig.animation_data.action if rig else None
    for action in actions:
        if rig:rig.animation_data.action=action
        end=int(action.frame_range[1]) if action else 61
        for frame in [1,max(2,end//2),end]:
            scene.frame_set(frame);deps=bpy.context.evaluated_depsgraph_get();positions=[]
            for o in meshes:
                evaluated=o.evaluated_get(deps);m=evaluated.to_mesh()
                positions.extend(o.matrix_world@v.co for v in m.vertices);evaluated.to_mesh_clear()
            bounds=[[min(v[a] for v in positions),max(v[a] for v in positions)] for a in range(3)]
            if any(not math.isfinite(x) or abs(x)>20 for pair in bounds for x in pair):raise ValueError('exploded geometry')
            witness['frames'].append({'clip':action.name if action else 'mechanics','frame':frame,'bounds_m':bounds,'vertices':len(positions)})
    if rig:rig.animation_data.action=original
    scene.frame_set(1)
    bpy.ops.object.camera_add(location=camera);cam=bpy.context.object
    cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=scale;scene.camera=cam
    scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='TEXTURE'
    scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True;scene.display.shading.cavity_type='BOTH'
    scene.render.resolution_x=960;scene.render.resolution_y=800;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(EVIDENCE/(name+'-source-preview.png'))
    bpy.ops.render.render(write_still=True)
    witness['preview']=str(pathlib.Path(scene.render.filepath).relative_to(ROOT))
    (EVIDENCE/(name+'-geometry-witness.json')).write_text(json.dumps(witness,indent=2)+'\n')
inspect('character',ROOT/'assets/content/authored/CitizenSource.blend',(2.6,-5,1.75),(0,0,.9),2.25)
inspect('vehicle',ROOT/'assets/content/authored/CivicSedanSource.blend',(4,-6,3),(0,0,.65),5.8)
for name,scale,target in [('CoastalSixAircraft',11,(0,0,1.3)),('HarborLaunch',8,(0,0,1)),('UrbanBus',10,(0,0,1.3)),
 ('DeliveryTruck',8,(0,0,1.3)),('SubtropicalPalm',8,(0,0,3)),('AcousticGuitar',1.5,(0,0,.65)),('AudienceBalloon',13,(0,0,5))]:
    inspect(name,ROOT/('assets/content/authored/'+name+'.blend'),(scale*.7,-scale,scale*.5),target,scale)
inspect('CeramicCup',ROOT/'assets/content/authored/CeramicCup.blend',(.19,-.25,.22),(0,0,.05),.19)
inspect('Bicycle',ROOT/'assets/content/authored/Bicycle.blend',(2.7,-3.5,1.8),(0,0,.6),2.3)
inspect('RotorShuttle',ROOT/'assets/content/authored/RotorShuttle.blend',(9,-11,6),(0,1.3,1.4),11)
