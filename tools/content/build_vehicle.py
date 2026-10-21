"""Original fictional unbranded sedan source, Blender 3.0+.
All geometry authored here; detailed source art with functional sub-object pivots.
No native physics, visual quality, trademark likeness or driving approval claimed.
"""
import bpy, math, json, pathlib
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'unity/Assets/HOMELESS/Content/Vehicles';OUT.mkdir(parents=True,exist_ok=True)
MASTER=ROOT/'assets/content/authored';MASTER.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)

def material(name,color,metallic=0,roughness=.5,alpha=1,emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,alpha);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,alpha)
    p.inputs['Metallic'].default_value=metallic;p.inputs['Roughness'].default_value=roughness
    p.inputs['Alpha'].default_value=alpha
    if alpha<1:m.blend_method='BLEND';p.inputs['Transmission'].default_value=.2
    if emission:p.inputs['Emission'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    return m
paint=material('MidnightBluePearl',(.045,.12,.18),.7,.23)
chrome=material('BrushedAluminium',(.55,.6,.64),.95,.24)
rubber=material('TyreRubber',(.012,.014,.016),0,.9)
trim=material('GraphiteTrim',(.028,.032,.039),.05,.7)
leather=material('WarmUpholstery',(.19,.115,.069),0,.73)
stitch=material('UpholsteryStitch',(.47,.35,.23),0,.8)
glass=material('AutomotiveGlass',(.21,.29,.31),.15,.1,.23)
light=material('HeadlampLens',(.83,.9,1),.1,.17,1,.35)
red=material('TailLampLens',(.5,.012,.009),.1,.22,1,.25)

def mesh(name,verts,faces,mat,parent=None,bevel=0):
    m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.update()
    m.use_auto_smooth=True
    o=bpy.data.objects.new(name,m);bpy.context.collection.objects.link(o);o.data.materials.append(mat)
    for p in m.polygons:p.use_smooth=True
    if parent:o.parent=parent
    if bevel:
        b=o.modifiers.new('Manufactured edge radii','BEVEL');b.width=bevel;b.segments=3
        w=o.modifiers.new('Surface normals','WEIGHTED_NORMAL')
    return o

def empty(name,location=(0,0,0),parent=None):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.location=location
    if parent:o.parent=parent
    return o

root=empty('CivicSedan')
def box(name,center,size,mat,parent=root,bevel=.02):
    x,y,z=center;a,b,c=[d/2 for d in size]
    v=[(x+dx*a,y+dy*b,z+dz*c) for dx,dy,dz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    return mesh(name,v,[(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],mat,parent,bevel)

def tube(name,points,radius,mat,parent=root,sides=10):
    verts=[]
    for i,p in enumerate(points):
        p=Vector(p);d=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(i-1,0)])
        if d.length<1e-7:d=Vector((0,0,1))
        d.normalize();ref=Vector((0,0,1)) if abs(d.z)<.95 else Vector((0,1,0))
        a=d.cross(ref).normalized();b=d.cross(a).normalized()
        verts.extend(tuple(p+radius*(math.cos(t*math.tau/sides)*a+math.sin(t*math.tau/sides)*b)) for t in range(sides))
    faces=[(j*sides+k,j*sides+(k+1)%sides,(j+1)*sides+(k+1)%sides,(j+1)*sides+k) for j in range(len(points)-1) for k in range(sides)]
    return mesh(name,verts,faces,mat,parent)

def torus(name,center,major,minor,mat,parent=root,axis='X',segments=64):
    verts=[];sides=12
    for i in range(segments):
        u=i*math.tau/segments
        for j in range(sides):
            v=j*math.tau/sides;r=major+minor*math.cos(v)
            p=(minor*math.sin(v),r*math.sin(u),r*math.cos(u)) if axis=='X' else (r*math.cos(u),r*math.sin(u),minor*math.sin(v))
            verts.append(tuple(center[k]+p[k] for k in range(3)))
    faces=[(i*sides+j,((i+1)%segments)*sides+j,((i+1)%segments)*sides+(j+1)%sides,i*sides+(j+1)%sides) for i in range(segments) for j in range(sides)]
    return mesh(name,verts,faces,mat,parent)

def shaped_shell(name,sections,mat):
    # Eight points around each cross-section give crowned painted surfaces.
    verts=[]
    for y,width,low,high in sections:
        verts.extend([(-width*.85,y,low),(-width,y,low+.12),(-width,y,high-.08),(-width*.75,y,high),
          (width*.75,y,high),(width,y,high-.08),(width,y,low+.12),(width*.85,y,low)])
    faces=[(j*8+k,j*8+(k+1)%8,(j+1)*8+(k+1)%8,(j+1)*8+k) for j in range(len(sections)-1) for k in range(8)]
    faces += [tuple(reversed(range(8))),tuple((len(sections)-1)*8+k for k in range(8))]
    return mesh(name,verts,faces,mat,root,.035)

# Separate engine and trunk volumes leave an accessible cabin instead of a solid car-shaped block.
shaped_shell('SculptedBonnet',[(-2.28,.72,.47,.68),(-2.14,.86,.45,.76),(-1.75,.9,.46,.86),(-1.05,.9,.48,.92),(-.86,.87,.49,.95)],paint)
shaped_shell('RearDeck',[(.98,.86,.48,.95),(1.35,.9,.46,.91),(1.95,.88,.44,.85),(2.25,.76,.46,.75)],paint)
# Actual wheel-arch apertures: exterior trim alone must not hide a solid panel
# intersecting the rotating tyre volume.
for shell_name,y in [('SculptedBonnet',-1.43),('RearDeck',1.43)]:
    shell=bpy.data.objects[shell_name]
    for side in (-1,1):
        bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=.385,depth=.8,location=(side*.86,y,.34),rotation=(0,math.pi/2,0))
        cutter=bpy.context.object;cutter.name='TemporaryWheelAperture'
        modifier=shell.modifiers.new('ActualWheelAperture','BOOLEAN');modifier.operation='DIFFERENCE';modifier.object=cutter;modifier.solver='EXACT'
        bpy.context.view_layer.objects.active=shell;bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.data.objects.remove(cutter,do_unlink=True)
box('Underbody',(0,0,.34),(1.66,3.95,.14),trim,bevel=.04)
box('CabinCarpet',(0,.05,.43),(1.58,1.98,.07),trim)
for side in (-1,1):
    box('RockerPanel_'+str(side),(side*.85,.05,.46),(.12,2.2,.17),paint,bevel=.03)
    for y in (-1.43,1.43):
        points=[(side*.918,y+.405*math.cos(t*math.pi/32),.37+.405*math.sin(t*math.pi/32)) for t in range(33)]
        tube('WheelArchTrim',points,.025,trim,sides=8)
    # Exterior side mirrors contain a distinct reflective face.
    box('MirrorHousing_'+str(side),(side*1.01,-.66,1.01),(.22,.25,.115),paint,bevel=.04)
    box('MirrorGlass_'+str(side),(side*1.02,-.54,1.015),(.17,.012,.073),chrome,bevel=.015)

roofverts=[];rooffaces=[]
for j in range(13):
    y=-.43+j*1.24/12
    for i in range(21):
        x=-.72+i*1.44/20;z=1.45+.055*(1-(x/.72)**2)-.035*((y-.19)/.62)**2
        roofverts.append((x,y,z))
for j in range(12):
    for i in range(20):a=j*21+i;rooffaces.append((a,a+1,a+22,a+21))
mesh('CrownedRoof',roofverts,rooffaces,paint,root,.009)
for ybase,ytop,label in [(-.91,-.43,'Windshield'),(1.18,.81,'RearWindow')]:
    mesh(label,[(-.84,ybase,.94),(.84,ybase,.94),(.70,ytop,1.45),(-.70,ytop,1.45)],[(0,1,2,3)],glass,root)
    for side in (-1,1):tube(label+'_Pillar',[(side*.84,ybase,.92),(side*.70,ytop,1.46)],.04,paint,sides=12)
    tube(label+'_Seal',[(-.84,ybase,.94),(.84,ybase,.94)],.014,rubber)
for side in (-1,1):tube('RoofRail',[(side*.72,-.44,1.45),(side*.73,.1,1.5),(side*.72,.81,1.45)],.028,chrome)

doors=[]
for side in (-1,1):
    for index,(start,end,ztop) in enumerate([(-.86,.12,1.44),(.15,1.10,1.43)]):
        name=('Left' if side<0 else 'Right')+('FrontDoor' if index==0 else 'RearDoor')
        hinge=empty(name,(side*.86,start,.72),root);doors.append(hinge)
        length=end-start
        # Geometry is in hinge-local coordinates so opening reveals the actual cabin.
        box(name+'_Paint',(0,length/2,0),(.07,length-.035,.46),paint,hinge,.035)
        box(name+'_InnerPanel',(-side*.055,length/2,.015),(.07,length-.10,.37),leather,hinge,.04)
        box(name+'_ArmRest',(-side*.12,length*.52,.035),(.12,.46,.07),trim,hinge,.03)
        box(name+'_Handle',(side*.065,length*.79,.13),(.034,.13,.025),chrome,hinge,.009)
        top0=.71 if index else .36; top1=.35 if index else .71
        glassverts=[(0,.035,.25),(0,length-.035,.25),(-side*.12,length-.05,top1),(-side*.12,.05,top0)]
        mesh(name+'_Glass',glassverts,[(0,1,2,3)],glass,hinge)
        for a,b in [(0,1),(1,2),(2,3),(3,0)]:tube(name+'_WindowFrame',[glassverts[a],glassverts[b]],.018,chrome,hinge,sides=8)
    tube('B_Pillar',[(side*.86,.135,.5),(side*.74,.135,1.48)],.042,trim)

# Four separate wheel transforms carry tyre, tread, rim, brake and hub geometry.
wheels=[]
for side in (-1,1):
    for y in (-1.43,1.43):
        name=('Left' if side<0 else 'Right')+('FrontWheel' if y<0 else 'RearWheel')
        wheel=empty(name,(side*.86,y,.34),root);wheels.append(wheel)
        torus(name+'_Tyre',(0,0,0),.262,.073,rubber,wheel)
        torus(name+'_Rim',(side*.073,0,0),.216,.023,chrome,wheel)
        torus(name+'_BrakeDisc',(side*.045,0,0),.163,.012,chrome,wheel)
        for i in range(64):
            a=i*math.tau/64
            tube(name+'_Tread',[(x,.333*math.sin(a+x*.9),.333*math.cos(a+x*.9)) for x in (-.055,0,.055)],.004,trim,wheel,sides=4)
        for i in range(10):
            a=i*math.tau/10
            tube(name+'_Spoke',[(side*.082,.06*math.sin(a),.06*math.cos(a)),(side*.08,.2*math.sin(a+.08),.2*math.cos(a+.08))],.018,chrome,wheel,sides=8)
        torus(name+'_Hub',(side*.083,0,0),.047,.018,chrome,wheel,segments=32)

# Upholstered seats, separate bolsters, head restraints, seams and belts.
for row,y in [('Front',-.22),('Rear',.69)]:
    for side in (-1,1):
        x=side*.43;name=row+('Left' if side<0 else 'Right')+'Seat'
        box(name+'_Base',(x,y,.59),(.58,.56,.16),leather,bevel=.065)
        back=box(name+'_Back',(x,y+.24,.88),(.58,.16,.59),leather,bevel=.065)
        box(name+'_Headrest',(x,y+.26,1.24),(.28,.13,.18),leather,bevel=.04)
        for s in (-1,1):
            box(name+'_Bolster',(x+s*.23,y+.17,.86),(.10,.15,.49),leather,bevel=.045)
            tube(name+'_Stitch',[(x+s*.2,y-.2,.678),(x+s*.2,y+.18,.678),(x+s*.2,y+.143,1.12)],.0025,stitch,sides=6)
        tube(name+'_Belt',[(x+side*.26,y+.21,1.15),(x-side*.21,y-.05,.65)],.018,trim,sides=6)
        empty(name+'_OccupantAnchor',(x,y,.66),root)

shaped_shell('Dashboard',[(-.83,.8,.74,.91),(-.71,.8,.75,.90),(-.54,.74,.76,.86)],trim)
box('CenterConsole',(0,-.08,.66),(.23,.77,.31),trim,bevel=.035)
box('CenterDisplay',(0,-.52,.88),(.26,.035,.14),glass,bevel=.012)
for i in range(5):box('ClimateButton',(-.10+i*.05,-.495,.79),(.026,.025,.018),chrome,bevel=.004)
for side in (-1,1):
    for i in range(5):box('VentSlat',(side*.61,-.527,.85+i*.012),(.19,.012,.006),chrome,bevel=.002)
tube('GearSelector',[(0,-.15,.82),(0,-.16,.94)],.018,chrome)
box('GearGrip',(0,-.16,.95),(.05,.08,.04),leather,bevel=.015)
steering=empty('SteeringWheel',(-.43,-.45,.94),root)
torus('SteeringRim',(0,0,0),.17,.018,leather,steering,axis='Z')
for a in (0,2.15,4.13):tube('SteeringSpoke',[(0,0,0),(.15*math.cos(a),.15*math.sin(a),0)],.018,trim,steering)
box('SteeringHub',(0,0,0),(.12,.09,.035),trim,steering,.02)
steering.rotation_euler.x=math.radians(66)
tube('SteeringColumn',[(-.43,-.45,.94),(-.43,-.70,.79)],.027,trim)
for x in (-.51,-.35):box('Pedal',(x,-.65,.49),(.07,.13,.018),rubber,bevel=.008)
for front,y in [(True,-2.265),(False,2.23)]:
    for side in (-1,1):
        box('Headlight' if front else 'TailLight',(side*.57,y,.69),(.32,.055,.10),light if front else red,bevel=.025)
        for i in range(6):box('LampOptic',(side*.57-.12+i*.048,y-.03 if front else y+.03,.69),(.019,.025,.065),chrome,bevel=.006)
    box('Bumper',(0,y,.46),(1.47,.10,.10),trim,bevel=.035)
for i in range(9):box('GrilleSlat',(0,-2.312,.50+i*.012),(.75,.018,.006),chrome,bevel=.002)
for side in (-1,1):tube('ExhaustOutlet',[(side*.45,2.0,.31),(side*.45,2.29,.31)],.035,chrome)

# Explicit rig clips are authoring/test motions, not autonomous driving behavior.
for door in doors:
    door.rotation_euler=(0,0,0);door.keyframe_insert('rotation_euler',frame=1)
    door.rotation_euler.z=math.radians(65 if door.name.startswith('Left') else -65);door.keyframe_insert('rotation_euler',frame=31)
    door.rotation_euler.z=0;door.keyframe_insert('rotation_euler',frame=61)
    door.animation_data.action.name=door.name+'_OpenClose';door.animation_data.action.use_fake_user=True
for wheel in wheels:
    wheel.rotation_euler.x=0;wheel.keyframe_insert('rotation_euler',frame=1)
    wheel.rotation_euler.x=math.tau;wheel.keyframe_insert('rotation_euler',frame=61)
    wheel.animation_data.action.name=wheel.name+'_Spin';wheel.animation_data.action.use_fake_user=True
    for c in wheel.animation_data.action.fcurves:
        for k in c.keyframe_points:k.interpolation='LINEAR'
scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=61;scene.render.fps=30;scene.frame_set(1)
bpy.ops.object.select_all(action='SELECT')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(MASTER/'CivicSedanSource.blend'),compress=True)
bpy.ops.export_scene.fbx(filepath=str(OUT/'CivicSedan.fbx'),use_selection=True,object_types={'MESH','EMPTY'},
  add_leaf_bones=False,bake_anim=True,bake_anim_use_all_actions=False,bake_anim_use_nla_strips=False,
  path_mode='COPY',axis_forward='-Z',axis_up='Y',use_mesh_modifiers=True)
deps=bpy.context.evaluated_depsgraph_get();triangles=0
for o in scene.objects:
    if o.type=='MESH':
        m=o.evaluated_get(deps).to_mesh();triangles+=sum(len(p.vertices)-2 for p in m.polygons);o.evaluated_get(deps).to_mesh_clear()
report={'schema':'homeless.vehicle-content/1','asset':'CivicSedan','license':'CC0-1.0','source':'original authored geometry',
 'brand':'fictional unbranded','units':'meters','blender_axes':{'up':'+Z','front':'-Y','right':'+X'},
 'source_triangles':triangles,'mesh_objects':sum(o.type=='MESH' for o in scene.objects),
 'doors':[d.name for d in doors],'wheels':[w.name for w in wheels],
 'seats':4,'wheel_radius_m':.335,'wheelbase_m':2.86,'steering_transform':'SteeringWheel',
 'seat_anchor_suffix':'Seat_OccupantAnchor','door_hinge_axis':'local Z before FBX conversion','wheel_spin_axis':'local X',
 'native_import':'NOT_RUN','drivable_status':'display_only_until_native_dynamics_and_seating_pass',
 'cinematic_visual_gate':'NOT_RUN','source_review':'pending generated preview',
 'limitations':['Original source master has no optimized LODs yet.','Wheel/body arch penetration and seat/door fit require native collision and motion review.',
 'Animation shows rig mechanics only; vehicle physics, traffic and authority belong to the game adapter.']}
(OUT/'vehicle.json').write_text(json.dumps(report,indent=2)+'\n')
(ROOT/'evidence/content/vehicle.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'triangles':triangles,'meshes':report['mesh_objects']}))
