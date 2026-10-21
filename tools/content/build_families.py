"""Original source masters for transport, foliage and a performance scene.
Detailed geometry and named attachment points are source-art work, not a passed
native cinematic, driving, flight, buoyancy or boarding gate.
"""
import bpy, pathlib, sys, math, json
from mathutils import Vector
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import mesh_library as lib
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'unity/Assets/HOMELESS/Content/Families';OUT.mkdir(parents=True,exist_ok=True)
MASTER=ROOT/'assets/content/authored'
summaries=[];current=None
def begin(name):
    global current
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    current=lib.empty(name);lib.root=current;return current
def box(name,center,size,mat=None,bevel=.02,parent=None):return lib.box(name,center,size,mat or lib.paint,parent or current,bevel)
def tube(name,points,radius,mat=None,sides=10,parent=None):return lib.tube(name,points,radius,mat or lib.chrome,parent or current,sides)
def mesh(name,verts,faces,mat=None,bevel=0,parent=None):return lib.mesh(name,verts,faces,mat or lib.paint,parent or current,bevel)
def anchor(name,p,parent=None):return lib.empty(name,p,parent or current)
def torus(name,p,radius,width,mat=None,axis='X',segments=48,parent=None):return lib.torus(name,p,radius,width,mat or lib.rubber,parent or current,axis,segments)
def loft(name,sections,mat,segments=48):
    v=[]
    for y,rx,rz,zc in sections:
        v.extend((rx*math.sin(i*math.tau/segments),y,zc+rz*math.cos(i*math.tau/segments)) for i in range(segments))
    f=[(j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i) for j in range(len(sections)-1) for i in range(segments)]
    f += [tuple(reversed(range(segments))),tuple((len(sections)-1)*segments+i for i in range(segments))]
    return mesh(name,v,f,mat)
def finish(name,family,interactions):
    bpy.context.scene.frame_set(1);bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(MASTER/(name+'.blend')),compress=True)
    bpy.ops.object.select_all(action='SELECT')
    animated=any(o.animation_data and o.animation_data.action for o in bpy.context.scene.objects)
    bpy.ops.export_scene.fbx(filepath=str(OUT/(name+'.fbx')),use_selection=True,object_types={'MESH','EMPTY'},
      bake_anim=animated,bake_anim_use_all_actions=False,bake_anim_use_nla_strips=False,axis_forward='-Z',axis_up='Y',use_mesh_modifiers=True)
    deps=bpy.context.evaluated_depsgraph_get();count=0;vertices=[]
    for o in bpy.context.scene.objects:
        if o.type!='MESH':continue
        eo=o.evaluated_get(deps);m=eo.to_mesh();count+=sum(len(p.vertices)-2 for p in m.polygons)
        vertices.extend(o.matrix_world@v.co for v in m.vertices);eo.to_mesh_clear()
    record={'name':name,'family':family,'license':'CC0-1.0','source':'original mathematical surface and mechanical detail authoring',
      'triangles':count,'mesh_objects':sum(o.type=='MESH' for o in bpy.context.scene.objects),'units':'meters',
      'blender_axes':{'up':'+Z','front':'-Y'},'bounds_m':[[min(v[i] for v in vertices),max(v[i] for v in vertices)] for i in range(3)],
      'attachments':interactions,'actions':[o.animation_data.action.name for o in bpy.context.scene.objects if o.animation_data and o.animation_data.action],
      'native_import':'NOT_RUN','visual_acceptance':'NOT_RUN','gameplay_status':'source_only',
      'limitations':['No native captures, mobile LOD/texture profile or measured collision fit yet.',
      'Named control/boarding transforms require runtime binding and acceptance scenarios.']}
    summaries.append(record);(OUT/(name+'.json')).write_text(json.dumps(record,indent=2)+'\n')

def seat(name,x,y,z=.7,parent=None):
    box(name+'Cushion',(x,y,z),(.48,.48,.12),lib.leather,.045,parent)
    box(name+'Back',(x,y+.2,z+.27),(.48,.11,.56),lib.leather,.04,parent)
    for side in (-1,1):tube(name+'Seam',[(x+side*.18,y-.18,z+.065),(x+side*.18,y+.16,z+.065),(x+side*.18,y+.14,z+.5)],.003,lib.stitch,6,parent)
    anchor(name+'Occupant',(x,y,z+.07),parent)

def wheel(name,x,y,z=.48,radius=.46):
    pivot=anchor(name,(x,y,z));torus(name+'Tyre',(0,0,0),radius-.09,.09,lib.rubber,parent=pivot)
    torus(name+'Rim',(.095 if x>0 else -.095,0,0),radius-.16,.025,lib.chrome,parent=pivot)
    for i in range(12):
        a=i*math.tau/12;tube(name+'Spoke',[(0,0,0),(0,(radius-.16)*math.sin(a),(radius-.16)*math.cos(a))],.024,lib.chrome,8,pivot)

def commercial(name,bus=False):
    begin(name);length=8.6 if bus else 6.6;front=-length/2;back=length/2;width=1.2
    box('Chassis',(0,0,.54),(2.15,length-.35,.24),lib.trim,.06)
    box('Floor',(0,.05,.82),(2.25,length-.45,.12),lib.trim,.025)
    if bus:
        # Cabin is hollow, with glazed openings, a lowered entrance, twenty seats and an aisle.
        for side in (-1,1):
            box('LowerBody',(side*1.17,0,1.27),(.075,length-.3,.78),lib.paint,.055)
            for j in range(9):
                y=front+.45+j*.94
                box('WindowPillar',(side*1.15,y,2.1),(.075,.06,1.0),lib.chrome,.012)
                mesh('SideWindow',[(side*1.17,y+.04,1.7),(side*1.17,y+.84,1.7),(side*1.12,y+.84,2.56),(side*1.12,y+.04,2.56)],[(0,1,2,3)],lib.glass)
            tube('HandRail',[(side*.85,front+1.2,2.45),(side*.85,back-.5,2.45)],.025)
            for row in range(5):
                for x in (.48,.94):seat('Passenger',side*x,front+1.8+row*1.05,.94)
        roof=[];faces=[]
        for j in range(25):
            y=front+.08+j*(length-.16)/24
            for i in range(25):
                x=-1.18+i*2.36/24;roof.append((x,y,2.62+.16*(1-(x/1.18)**2)))
        for j in range(24):
            for i in range(24):a=j*25+i;faces.append((a,a+1,a+26,a+25))
        mesh('CrownedBusRoof',roof,faces,lib.paint)
        door=anchor('PassengerDoorHinge',(1.19,front+.22,1.45))
        box('DoorFrame',(0,.40,0),(.05,.76,1.6),lib.trim,.02,door)
        box('DoorGlazing',(.03,.40,.2),(.012,.64,.95),lib.glass,.015,door)
        for k in range(3):box('EntryStep',(.88,front+.63,.42+k*.13),(.65-.12*k,.66,.08),lib.trim,.015)
        anchor('BoardingPoint',(1.5,front+.6,.15));seat('Driver',-.68,front+.65,1.02)
    else:
        # Distinct two-seat cab and a ribbed cargo enclosure with opening tail doors.
        box('CabRear',(0,front+1.85,1.62),(2.24,.08,1.65),lib.paint,.06)
        box('CabRoof',(0,front+1.0,2.52),(2.26,1.88,.16),lib.paint,.08)
        for side in (-1,1):
            d=anchor('CabDoor_'+str(side),(side*1.13,front+.3,1.3))
            box('DoorShell',(0,.62,0),(.08,1.2,.76),lib.paint,.035,d)
            box('SideWindow',(0,.62,.75),(.025,1.1,.63),lib.glass,.02,d)
            seat('CabSeat',side*.6,front+1.15,1.0)
        box('CargoRoof',(0,1.06,2.8),(2.4,4.25,.12),lib.paint,.025)
        for side in (-1,1):
            box('CargoWall',(side*1.19,1.08,1.85),(.05,4.3,1.8),lib.chrome,.01)
            for j in range(40):box('CargoRib',(side*1.225,-1+j*.105,1.85),(.035,.022,1.8),lib.chrome,.004)
            hinge=anchor('CargoTailDoor_'+str(side),(side*1.19,back-.1,1.82))
            box('CargoDoor',(-side*.58,0,0),(1.16,.07,1.82),lib.chrome,.02,hinge)
        anchor('CargoLoadPoint',(0,back+.5,.78))
    mesh('Windscreen',[(-1.08,front+.08,1.55),(1.08,front+.08,1.55),(1.04,front+.30,2.5),(-1.04,front+.30,2.5)],[(0,1,2,3)],lib.glass)
    box('FrontPanel',(0,front+.03,1.11),(2.2,.15,.64),lib.paint,.07)
    box('FrontBumper',(0,front-.06,.66),(2.25,.15,.2),lib.trim,.035)
    for side in (-1,1):
        box('Headlamp',(side*.86,front-.06,1.06),(.32,.03,.14),lib.light,.02)
        wheel(('Left' if side<0 else 'Right')+'FrontWheel',side*1.13,front+1.0)
        wheel(('Left' if side<0 else 'Right')+'RearWheel',side*1.13,back-1.15)
        if not bus:wheel(('Left' if side<0 else 'Right')+'RearSecondWheel',side*1.13,back-2.18)
    finish(name,'bus' if bus else 'truck',{'driver':'DriverOccupant' if bus else 'CabSeatOccupant','wheels':4 if bus else 6,'seats':21 if bus else 2})

def aircraft():
    begin('CoastalSixAircraft');body=lib.material('AircraftIvory',(.69,.73,.76),.35,.3)
    sections=[]
    for i in range(65):
        t=i/64;y=-3.6+7.2*t;shape=math.sin(math.pi*t)**.65
        radius=.73*shape*(1-.50*max(0,(t-.55)/.45));sections.append((y,radius,radius*.94,1.65))
    fuselage=loft('Fuselage',sections,body,64)
    fuselage.data.materials.append(lib.glass)
    for polygon in fuselage.data.polygons:
        center=sum((fuselage.data.vertices[i].co for i in polygon.vertices),Vector())/len(polygon.vertices)
        if -1.80<center.y<-.88 and center.z>2.0 and abs(center.x)<.56:polygon.material_index=1
    shell=fuselage.modifiers.new('CabinShellThickness','SOLIDIFY');shell.thickness=.025
    bpy.context.view_layer.objects.active=fuselage;bpy.ops.object.modifier_apply(modifier=shell.name)
    for j in range(3):
        y=-.75+j*.74
        bpy.ops.mesh.primitive_cube_add(size=1,location=(0,y,1.975));cutter=bpy.context.object;cutter.scale=(2,.50,.27)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        cut=fuselage.modifiers.new('OpenCabinWindow','BOOLEAN');cut.operation='DIFFERENCE';cut.object=cutter;cut.solver='EXACT'
        bpy.context.view_layer.objects.active=fuselage;bpy.ops.object.modifier_apply(modifier=cut.name);bpy.data.objects.remove(cutter,do_unlink=True)
    # Cambered airfoil skins with taper, separate flap and aileron control surfaces.
    for side in (-1,1):
        vertices=[];faces=[]
        for span in range(25):
            s=span/24;x=side*(.5+s*4.6);chord=1.6-.8*s
            for c in range(25):
                phase=c*math.tau/24;yc=-.2+math.cos(phase)*chord*.5;z=1.50+.10*math.sin(phase)*math.sqrt(max(.05,1-s))+.18*s
                vertices.append((x,yc,z))
        for j in range(24):
            for k in range(24):a=j*25+k;faces.append((a,a+1,a+26,a+25))
        mesh('CamberedWing',vertices,faces,body)
        flap=anchor('Flap_'+str(side),(side*2.0,.51,1.54));box('FlapSurface',(side*.2,0,0),(2.1,.23,.04),body,.02,flap)
        tail=mesh('HorizontalStabilizer',[(side*.15,2.53,1.65),(side*1.5,2.70,1.65),(side*1.30,3.15,1.66),(side*.1,3.07,1.66)],[(0,1,2,3)],body)
        tube('MainGearStrut',[(side*.65,.42,1.26),(side*1.0,.52,.32)],.055,lib.chrome)
        torus('LandingTyre',(side*1.0,.52,.30),.23,.07)
        for j in range(3):seat('CabinPassenger',side*.33,-.75+j*.72,1.45)
    mesh('TailFin',[(0,2.2,1.72),(0,2.75,2.95),(0,3.25,2.77),(0,3.27,1.75)],[(0,1,2,3)],body)
    for side in (-1,1):
        for j in range(3):
            y=-1.0+j*.74
            mesh('CabinWindow',[(side*.65,y,1.84),(side*.65,y+.50,1.84),(side*.54,y+.50,2.11),(side*.54,y,2.11)],[(0,1,2,3)],lib.glass)
    prop=anchor('Propeller',(0,-3.65,1.65))
    for i in range(3):
        a=i*math.tau/3
        v=[]
        for j in range(18):
            r=.12+j*.055;width=.13*math.sin((j+1)/19*math.pi)
            for s in (-1,1):v.append((r*math.cos(a)+s*width*math.sin(a),-.02+s*.025,r*math.sin(a)-s*width*math.cos(a)))
        mesh('TwistedPropellerBlade',v,[(j*2,j*2+1,j*2+3,j*2+2) for j in range(17)],lib.trim,parent=prop)
    anchor('BoardingPoint',(1.0,-.65,.3));anchor('PilotSeat',(-.33,-.75,1.52))
    finish('CoastalSixAircraft','small passenger aircraft',{'seats':6,'pilot':'PilotSeat','propeller':'Propeller','flaps':['Flap_-1','Flap_1']})

def boat():
    begin('HarborLaunch');hullmat=lib.material('HullIvory',(.69,.70,.65),.15,.4)
    # Open-topped hull with closed bow/stern below the gunwale, inner lining and deck.
    verts=[];faces=[];rows=49;cols=33
    for j in range(rows):
        t=j/(rows-1);y=-3.5+7*t;w=1.12*(math.sin(math.pi*(.03+.94*t))**.38)
        for i in range(cols):
            u=(i/(cols-1))*math.pi;verts.append((-w*math.cos(u),y,.88-.78*math.sin(u)**.6+.13*(1-t)**3))
    for j in range(rows-1):
        for i in range(cols-1):a=j*cols+i;faces.append((a,a+1,a+cols+1,a+cols))
    faces.extend([tuple(reversed(range(cols))),tuple((rows-1)*cols+i for i in range(cols))])
    hull=mesh('SweptHull',verts,faces,hullmat)
    wall=hull.modifiers.new('HullLining','SOLIDIFY');wall.thickness=.035;wall.offset=-1
    box('Deck',(0,.2,.73),(1.85,5.4,.12),lib.leather,.08)
    for side in (-1,1):
        points=[]
        for j in range(rows):
            t=j/(rows-1);points.append((side*1.12*math.sin(math.pi*(.03+.94*t))**.38,-3.5+7*t,1.0))
        tube('Gunwale',points,.045,hullmat,12)
        tube('SafetyRail',[(x,y,z+.43) for x,y,z in points],.023,lib.chrome,8)
        for j in range(2,47,5):
            x,y,z=points[j];tube('RailStanchion',[(x,y,z),(x,y,z+.43)],.023,lib.chrome)
        for j in range(2):seat('Passenger',side*.50,.6+j*.85,.94)
    box('HelmConsole',(0,-.8,1.1),(.80,.45,.65),hullmat,.07)
    mesh('Windshield',[(-.78,-1.28,1.35),(.78,-1.28,1.35),(.7,-1.05,1.95),(-.7,-1.05,1.95)],[(0,1,2,3)],lib.glass)
    for side in (-1,1):tube('CanopyPole',[(side*.8,-.9,.85),(side*.8,-.9,2.2),(side*.8,1.45,2.2),(side*.8,1.45,.85)],.032)
    box('Canopy',(0,.25,2.22),(1.72,2.55,.05),lib.trim,.05)
    anchor('HelmSeat',(0,-.20,1.07));anchor('BoardingPoint',(1.3,2.4,.73));anchor('Rudder',(0,3.25,.25));anchor('Propeller',(0,3.35,.15))
    for side in (-1,1):
        tube('BoardingLadder',[(side*.25,3.1,.85),(side*.25,3.55,.85),(side*.25,3.55,.05)],.025)
    for z in (.2,.45,.70):tube('LadderRung',[(-.25,3.55,z),(.25,3.55,z)],.025)
    finish('HarborLaunch','boat',{'seats':5,'helm':'HelmSeat','boarding':'BoardingPoint','rudder':'Rudder','propeller':'Propeller'})

def palm():
    begin('SubtropicalPalm');bark=lib.material('PalmBark',(.22,.16,.10),0,.95);leaf=lib.material('PalmLeaf',(.07,.20,.038),0,.8)
    points=[(.14*math.sin(j/18),.09*math.sin(j/11),j*.09) for j in range(61)]
    tube('CurvedTrunk',points,.19,bark,24)
    for j in range(3,60):
        z=j*.09;x,y,_=points[j]
        torus('LeafScar',(x,y,z),.192,.012,bark,axis='Z',segments=32)
    for k in range(20):
        az=k*2.39996;stem=[]
        for j in range(25):
            t=j/24;r=.12+2.1*t;z=5.25+.9*math.sin(t*math.pi*.9)-.7*t*t
            stem.append((r*math.cos(az),r*math.sin(az),z))
        tube('FrondStem',stem,.012,leaf,6)
        for j in range(3,24):
            t=j/24;p=Vector(stem[j]);width=.50*math.sin(t*math.pi)**.6
            for side in (-1,1):
                cross=Vector((-math.sin(az),math.cos(az),-.4))*side
                end=p+cross*width+Vector((.12*math.cos(az),.12*math.sin(az),-.16))
                mid=(p+end)/2+Vector((0,0,.05));along=Vector((math.cos(az),math.sin(az),0))*.025
                mesh('Leaflet',[tuple(p-along),tuple(p+along),tuple(mid+along),tuple(end),tuple(mid-along)],[(0,1,2,3,4)],leaf)
    anchor('WindBendRoot',(0,0,0));finish('SubtropicalPalm','foliage',{'wind_root':'WindBendRoot','botanical_claim':'original palm-inspired; not a scanned or certified species reconstruction'})

def guitar():
    begin('AcousticGuitar');wood=lib.material('SpruceTop',(.44,.25,.10),0,.5);sidewood=lib.material('MahoganySide',(.16,.055,.025),0,.45)
    verts=[];faces=[];n=128
    for y in (-.065,.065):
        for i in range(n):
            a=i*math.tau/n;z=.34+.29*math.cos(a)
            width=.19*(1-.32*math.exp(-((z-.38)/.08)**2))*(1-.18*(z-.34)/.29)
            verts.append((width*math.sin(a),y,z))
    faces=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)];mesh('BoundResonatorSides',verts,faces,sidewood)
    hole=[(.055*math.sin(i*math.tau/n),-.065,.43+.055*math.cos(i*math.tau/n)) for i in range(n)]
    mesh('Soundboard',verts[:n]+hole,[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],wood)
    inside=[(x,.055,z) for x,_,z in hole]
    mesh('SoundholeInnerWall',hole+inside,[(i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n)],sidewood)
    mesh('Back',verts[n:], [tuple(range(n))],sidewood)
    # Actual open soundboard annulus and inner wall, with concentric inlay.
    hole=torus('Rosette',(0,-.068,.43),.057,.004,lib.chrome,axis='Z',segments=64);hole.rotation_euler.x=math.pi/2
    box('Neck',(0,0,.84),(.065,.045,.57),sidewood,.012)
    box('Fingerboard',(0,-.027,.85),(.06,.012,.56),lib.trim,.003)
    box('Headstock',(0,.006,1.19),(.084,.034,.19),sidewood,.015)
    box('Bridge',(0,-.08,.23),(.13,.025,.028),sidewood,.008)
    for i in range(19):tube('Fret',[(-.03,-.038,.59+i*.025),(.03,-.038,.59+i*.025)],.0015,lib.chrome,6)
    for i in range(6):
        x=-.025+i*.01;tube('String',[(x,-.094,.24),(x,-.043,1.23)],.0006,lib.chrome,4)
        xside=-.056 if i<3 else .056;box('TuningKey',(xside,0,1.14+(i%3)*.05),(.03,.02,.018),lib.chrome,.006)
    anchor('LeftHandGrip',(0,-.05,.90));anchor('StrummingPoint',(0,-.10,.42));finish('AcousticGuitar','musical instrument',{'hands':['LeftHandGrip','StrummingPoint'],'strings':6})

def balloon():
    begin('AudienceBalloon');fabric=lib.material('BalloonCanvas',(.42,.11,.045),0,.82);wicker=lib.material('BasketWicker',(.29,.16,.055),0,.93)
    n=64;rows=49;verts=[];faces=[]
    for j in range(rows):
        t=j/(rows-1);z=3+7*t;r=.5+3.2*math.sin(math.pi*t)**.72
        for i in range(n):
            a=i*math.tau/n;gore=1+.016*math.cos(a*16);verts.append((r*math.cos(a)*gore,r*math.sin(a)*gore,z))
    for j in range(rows-1):
        for i in range(n):a=j*n+i;faces.append((a,j*n+(i+1)%n,(j+1)*n+(i+1)%n,a+n))
    mesh('StitchedGoreEnvelope',verts,faces,fabric)
    for k in range(16):tube('EnvelopeSeam',[verts[j*n+k*4] for j in range(rows)],.009,lib.stitch,6)
    box('BasketFloor',(0,0,.22),(2.1,1.7,.2),wicker,.05)
    for side in (-1,1):
        box('BasketLongWall',(0,side*.82,.8),(2.1,.09,1.1),wicker,.045)
        box('BasketEndWall',(side*1.02,0,.8),(.09,1.7,1.1),wicker,.045)
        for j in range(14):tube('WovenRib',[(-1.03,side*.88,.3+j*.075),(1.03,side*.88,.3+j*.075)],.016,lib.stitch,6)
        for y in (-.75,.75):tube('SuspensionCable',[(side*.94,y,1.2),(side*.94,y,2.4),(side*.4,y*.4,3.3)],.025,lib.chrome)
    box('BurnerFrame',(0,0,2.35),(1.8,1.3,.08),lib.trim,.02)
    for x in (-.4,.4):torus('BurnerRing',(x,0,2.45),.18,.035,lib.chrome,axis='Z')
    for i,p in enumerate([(-.5,-.3,.35),(.5,-.3,.35),(-.5,.3,.35),(.5,.3,.35)]):anchor('StandingPassenger'+str(i),p)
    anchor('BoardingPoint',(0,-1.2,.3));finish('AudienceBalloon','balloon',{'capacity':4,'boarding':'BoardingPoint','burner_height_m':2.45})

def cup():
    begin('CeramicCup');ceramic=lib.material('WarmIvoryCeramic',(.74,.70,.61),0,.24)
    # Closed radial section includes underside, external wall, rounded lip,
    # inner wall and inner base. The top is an actual hollow opening.
    section=[(0,0),(.026,0),(.029,.002),(.030,.007),(.032,.012),(.034,.026),(.037,.060),
      (.040,.092),(.0405,.098),(.040,.101),(.0385,.102),(.037,.101),(.0365,.098),
      (.036,.093),(.033,.061),(.030,.028),(.028,.015),(.026,.012),(0,.012)]
    n=96;verts=[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for r,z in section for i in range(n)]
    faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(section)-1) for i in range(n)]
    body=mesh('ContinuousHollowCup',verts,faces,ceramic)
    import bmesh
    bm=bmesh.new();bm.from_mesh(body.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0000001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(body.data);bm.free()
    handle_vertices=[];handle_faces=[]
    for i in range(49):
        a=-math.pi/2+math.pi*i/48
        center=Vector((.035+.034*math.cos(a),0,.055+.032*math.sin(a)))
        normal=Vector((.032*math.cos(a),0,.034*math.sin(a))).normalized()
        for j in range(16):
            angle=j*math.tau/16;handle_vertices.append(tuple(center+.005*(normal*math.cos(angle)+Vector((0,1,0))*math.sin(angle))))
    for i in range(48):
        for j in range(16):handle_faces.append((i*16+j,i*16+(j+1)%16,(i+1)*16+(j+1)%16,(i+1)*16+j))
    handle_faces.extend([tuple(reversed(range(16))),tuple(48*16+j for j in range(16))])
    mesh('CurvedCeramicHandle',handle_vertices,handle_faces,ceramic)
    anchor('GripPoint',(.060,0,.055));anchor('RimCenter',(0,0,.102))
    finish('CeramicCup','interactive cup',{'grip':'GripPoint','rim':'RimCenter','hollow':True,'source_pivot':'bottom-center','collision':'NOT_RUN'})

def write_summary():
    global summaries
    prior=json.loads((ROOT/'evidence/content/families.json').read_text())['assets']
    summaries.extend(row for row in prior if row['name'] not in {item['name'] for item in summaries})
    (ROOT/'evidence/content/families.json').write_text(json.dumps({'schema':'dark.source-families/1','assets':summaries},indent=2)+'\n')
    print(json.dumps({'families':len(summaries),'triangles':sum(x['triangles'] for x in summaries)}))
if __name__=='__main__':
    selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    builders={'UrbanBus':lambda:commercial('UrbanBus',True),'DeliveryTruck':lambda:commercial('DeliveryTruck',False),
     'CoastalSixAircraft':aircraft,'HarborLaunch':boat,'SubtropicalPalm':palm,'AcousticGuitar':guitar,'AudienceBalloon':balloon,'CeramicCup':cup}
    for name,builder in builders.items():
        if not selected or name in selected:builder()
    write_summary()
