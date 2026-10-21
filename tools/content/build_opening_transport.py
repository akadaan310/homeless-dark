"""Original bicycle and four-seat rotor shuttle, with articulated source controls.
No real manufacturer likeness, native dynamics or cinematic acceptance claimed.
"""
import pathlib,sys,math,bpy,json
from mathutils import Vector
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import build_families as f
lib=f.lib

def spin(obj,axis,name,angle=math.tau):
    obj.rotation_euler[axis]=0;obj.keyframe_insert('rotation_euler',frame=1)
    obj.rotation_euler[axis]=angle;obj.keyframe_insert('rotation_euler',frame=61)
    obj.animation_data.action.name=name
    for curve in obj.animation_data.action.fcurves:
        for key in curve.keyframe_points:key.interpolation='LINEAR'
    bpy.context.scene.frame_set(1)

def bicycle():
    f.begin('Bicycle');paint=lib.material('BicycleForestEnamel',(.055,.16,.10),.65,.26)
    front=-.66;rear=.68;z=.35
    for label,y in [('FrontWheel',front),('RearWheel',rear)]:
        pivot=f.anchor(label,(0,y,z))
        f.torus(label+'Tyre',(0,0,0),.316,.024,lib.rubber,segments=96,parent=pivot)
        f.torus(label+'Rim',(0,0,0),.300,.008,lib.chrome,segments=96,parent=pivot)
        f.tube(label+'Axle',[(-.058,0,0),(.058,0,0)],.013,lib.chrome,16,pivot)
        for i in range(36):
            a=i*math.tau/36;s=1 if i%2 else -1
            f.tube(label+'CrossedSpoke',[(s*.024,.035*math.sin(a),.035*math.cos(a)),(0,.298*math.sin(a+s*.25),.298*math.cos(a+s*.25))],.0013,lib.chrome,5,pivot)
        for i in range(72):
            a=i*math.tau/72
            f.tube(label+'Tread',[(x,.34*math.sin(a+x),.34*math.cos(a+x)) for x in (-.014,0,.014)],.0012,lib.trim,4,pivot)
        f.torus(label+'BrakeRotor',(-.035,0,0),.073,.006,lib.chrome,segments=48,parent=pivot)
        for i in range(6):
            a=i*math.tau/6;f.tube(label+'RotorArm',[(-.035,0,0),(-.035,.073*math.sin(a),.073*math.cos(a))],.004,lib.chrome,6,pivot)
        spin(pivot,0,label+'_Spin')
    headlow=(0,-.49,.83);headhigh=(0,-.43,1.02);seat=(0,.34,.91);crank=(0,.07,.34)
    for name,points,r in [('TopTube',[seat,headhigh],.018),('DownTube',[crank,headlow],.021),('SeatTube',[crank,seat],.019),('HeadTube',[headlow,headhigh],.023)]:f.tube(name,points,r,paint,16)
    for side in (-1,1):
        axle=(side*.045,rear,z)
        f.tube('ChainStay',[crank,axle],.012,paint,12);f.tube('SeatStay',[seat,axle],.011,paint,12)
        f.tube('ForkBlade',[(side*.045,-.49,.85),(side*.048,-.55,.55),(side*.045,front,z)],.014,paint,16)
        f.box('BrakeCaliper',(side*.048,front+.08,.40),(.035,.07,.045),lib.trim,.01)
    f.tube('SeatPost',[seat,(0,.34,1.03)],.014,lib.chrome,16)
    f.anchor('RiderSeat',(0,.35,1.055));saddle=[];faces=[]
    outline=[(-.032,.18),(.032,.18),(.068,.30),(.075,.46),(.045,.50),(-.045,.50),(-.075,.46),(-.068,.30)]
    for height in (1.025,1.055):saddle.extend((x,y,height) for x,y in outline)
    faces=[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]+[tuple(reversed(range(8))),tuple(range(8,16))]
    f.mesh('ContouredSaddle',saddle,faces,lib.leather,.008)
    f.tube('SteeringStem',[headhigh,(0,-.44,1.10),(0,-.57,1.10)],.016,lib.chrome,16)
    f.tube('Handlebar',[(-.30,-.53,1.08),(-.17,-.58,1.10),(0,-.58,1.10),(.17,-.58,1.10),(.30,-.53,1.08)],.012,lib.chrome,16)
    for side in (-1,1):
        f.tube('RubberGrip',[(side*.21,-.56,1.09),(side*.30,-.53,1.08)],.016,lib.rubber,16)
        f.tube('BrakeLever',[(side*.19,-.59,1.09),(side*.20,-.64,1.04),(side*.29,-.60,1.04)],.004,lib.chrome,8)
        f.tube('BrakeCable',[(side*.19,-.59,1.09),(side*.12,-.70,.95),(side*.07,-.61,.65),(side*.05,front+.08,.40)],.0025,lib.trim,6)
        f.anchor(('Left' if side<0 else 'Right')+'HandGrip',(side*.25,-.55,1.09))
    pedal=f.anchor('Crank',crank)
    f.torus('Chainring',(.070,0,0),.093,.006,lib.chrome,segments=64,parent=pedal)
    for side in (-1,1):
        f.tube('CrankArm',[(side*.075,0,0),(side*.075,0,side*.16)],.009,lib.chrome,10,pedal)
        f.box('Pedal',(side*.13,0,side*.16),(.11,.095,.025),lib.trim,.007,pedal)
        for i in (-1,1):f.tube('PedalTraction',[(side*.08,i*.035,side*.16+.016),(side*.18,i*.035,side*.16+.016)],.002,lib.chrome,5,pedal)
    spin(pedal,0,'Crank_Pedal')
    for j in range(6):f.torus('RearSprocket',(.047+j*.004,rear,z),.035+j*.004,.0025,lib.chrome,segments=48)
    for upper in (-1,1):
        points=[(.07,.07+t*(rear-.07),.34+upper*(.09*(1-t)+.047*t)) for t in [i/48 for i in range(49)]]
        f.tube('ChainRun',points,.003,lib.trim,6)
        for i,p in enumerate(points):
            if i%2==0:f.box('ChainLink',p,(.009,.012,.006),lib.chrome,.001)
    f.tube('RearRack',[(-.11,.50,.75),(-.11,.85,.75),(.11,.85,.75),(.11,.50,.75)],.006,lib.chrome,8)
    for side in (-1,1):f.tube('RackSupport',[(side*.10,.82,.74),(side*.045,rear,z)],.005,lib.chrome,8)
    f.box('RearReflector',(0,.86,.74),(.075,.012,.027),lib.red,.007)
    f.box('FrontLamp',(0,-.61,1.04),(.065,.06,.045),lib.light,.015)
    f.finish('Bicycle','bicycle',{'seats':1,'rider':'RiderSeat','wheels':['FrontWheel','RearWheel'],'wheel_axis':'localX','wheel_radius_m':.34,
      'pedals':'Crank','hands':['LeftHandGrip','RightHandGrip'],'rider_pose':'NOT_RUN; seated car pose is not bicycle contact proof'})

def rotor_shuttle():
    f.begin('RotorShuttle');paint=lib.material('RotorShuttleIvory',(.68,.71,.68),.28,.28)
    sections=[]
    for j in range(65):
        t=j/64;shape=math.sin(math.pi*t)**.58
        sections.append((-2.15+4.3*t,1.04*shape,.79*shape,1.28))
    body=f.loft('CabinShell',sections,paint,64);body.data.materials.append(lib.glass)
    all_vertices=[tuple(v.co) for v in body.data.vertices];remaining=[];materials=[];panels={-1:[],1:[]}
    for polygon in body.data.polygons:
        center=sum((body.data.vertices[i].co for i in polygon.vertices),Vector())/len(polygon.vertices)
        side=-1 if center.x<0 else 1;material=1 if center.y<-.72 and center.z>1.16 else 0
        # Use continuous ring/longitudinal boundaries, rather than a spatial
        # threshold that produces a visible stair-step around the curved door.
        row,around=divmod(polygon.index,64)
        if 24<=row<45 and (8<=around<24 or 40<=around<56):panels[side].append((tuple(polygon.vertices),1 if around<16 or around>=48 else 0))
        else:remaining.append(tuple(polygon.vertices));materials.append(material)
    old=body.data;new=bpy.data.meshes.new('CabinWithDoorOpenings');new.from_pydata(all_vertices,[],remaining);new.materials.append(paint);new.materials.append(lib.glass);body.data=new;bpy.data.meshes.remove(old)
    for p,m in zip(new.polygons,materials):p.material_index=m;p.use_smooth=True
    wall=body.modifiers.new('CabinSkinThickness','SOLIDIFY');wall.thickness=.025
    for side in (-1,1):
        hinge=f.anchor(('Left' if side<0 else 'Right')+'CabinDoor',(side*.84,-.56,1.2));used=sorted({i for polygon,_ in panels[side] for i in polygon});index={v:i for i,v in enumerate(used)}
        verts=[tuple(Vector(all_vertices[i])-hinge.location) for i in used];faces=[tuple(index[i] for i in polygon) for polygon,_ in panels[side]]
        door=f.mesh('FittedDoorPanel',verts,faces,paint,parent=hinge);door.data.materials.append(lib.glass)
        for p,(_,m) in zip(door.data.polygons,panels[side]):p.material_index=m
        wall=door.modifiers.new('DoorSkinThickness','SOLIDIFY');wall.thickness=.025
        edges={}
        for polygon,_ in panels[side]:
            for a,b in zip(polygon,polygon[1:]+polygon[:1]):
                edge=tuple(sorted((a,b)));edges[edge]=edges.get(edge,0)+1
        for (a,b),uses in edges.items():
            if uses==1:f.tube('ContinuousDoorSeal',[tuple(Vector(all_vertices[i])-hinge.location) for i in (a,b)],.008,lib.trim,6,hinge)
        f.box('DoorPull',(side*.19,.95,-.05),(.04,.16,.035),lib.chrome,.008,hinge)
        spin(hinge,2,hinge.name+'_Open',math.radians(65* -side))
    f.box('CabinFloor',(0,.05,.62),(1.50,2.25,.09),lib.trim,.035)
    for side in (-1,1):
        for row,y in [('Front',-.45),('Rear',.55)]:f.seat(row+('Left' if side<0 else 'Right'),side*.38,y,.77)
        points=[(side*.88,-1.70,.28),(side*.88,-1.55,.12),(side*.88,1.45,.12),(side*.88,1.65,.24)]
        f.tube('LandingSkid',points,.052,lib.chrome,16)
        for y in (-.7,.8):f.tube('SkidSupport',[(side*.5,y,.72),(side*.68,y,.33),(side*.88,y,.17)],.044,lib.chrome,12)
    f.box('InstrumentConsole',(0,-1.05,1.02),(1.12,.30,.30),lib.trim,.07)
    for side in (-1,1):
        f.box('InstrumentScreen',(side*.26,-.88,1.09),(.28,.018,.16),lib.glass,.01)
        for i in range(4):f.box('ConsoleSwitch',(side*.25+i*.035,-.87,.96),(.018,.025,.012),lib.chrome,.003)
        f.tube('CyclicControl',[(side*.38,-.65,.68),(side*.38,-.66,.95),(side*.38,-.60,1.0)],.016,lib.trim,10)
    f.loft('TaperedTailBoom',[(1.55,.39,.33,1.36),(2.2,.29,.26,1.45),(3.4,.20,.18,1.75),(4.6,.13,.14,2.02),(5.7,.075,.11,2.23)],paint,48)
    f.mesh('TailFin',[(0,4.85,2.10),(0,5.48,3.05),(0,5.85,2.89),(0,5.75,1.89)],[(0,1,2,3)],paint,.015)
    for side in (-1,1):f.mesh('TailStabilizer',[(0,4.1,1.98),(side*1.1,4.3,1.98),(side*.9,4.7,1.98),(0,4.6,1.98)],[(0,1,2,3)],paint,.015)
    f.loft('TransmissionCowling',[(-.52,.36,.15,2.02),(0,.48,.29,2.05),(.55,.35,.22,2.05),(.8,.18,.12,2.05)],paint,32)
    for side in (-1,1):
        for i in range(10):f.box('CoolingVent',(side*.41,-.25+i*.055,2.10),(.018,.024,.12),lib.trim,.004)
    main=f.anchor('MainRotor',(0,.05,2.57));tail=f.anchor('TailRotor',(.18,5.35,2.23));tail.rotation_euler.y=math.pi/2
    for pivot,radius,count in [(main,4.6,4),(tail,.72,4)]:
        f.torus('RotorHub',(0,0,0),.13 if pivot==main else .06,.03 if pivot==main else .015,lib.chrome,axis='Z',parent=pivot)
        for blade in range(count):
            angle=blade*math.tau/count;verts=[];faces=[]
            for j in range(25):
                t=j/24;r=(.22 if pivot==main else .08)+(radius-(.22 if pivot==main else .08))*t
                chord=(.27-.07*t) if pivot==main else (.09-.025*t)
                for k in range(12):
                    phase=k*math.tau/12;along=chord*.5*math.cos(phase);height=chord*.08*math.sin(phase)+.02*t
                    verts.append((r*math.cos(angle)-along*math.sin(angle),r*math.sin(angle)+along*math.cos(angle),height))
            for j in range(24):
                for k in range(12):faces.append((j*12+k,j*12+(k+1)%12,(j+1)*12+(k+1)%12,(j+1)*12+k))
            faces.extend([tuple(reversed(range(12))),tuple(24*12+k for k in range(12))]);f.mesh('AirfoilRotorBlade',verts,faces,lib.trim,parent=pivot)
            f.tube('PitchLink',[(.07*math.cos(angle),.07*math.sin(angle),-.11),(.24*math.cos(angle),.24*math.sin(angle),0)],.012,lib.chrome,8,pivot)
        spin(pivot,2,pivot.name+'_Spin')
    f.tube('MainShaft',[(0,.05,2.18),(0,.05,2.61)],.06,lib.chrome,24)
    f.tube('TailShaft',[(0,5.35,2.23),(.22,5.35,2.23)],.025,lib.chrome,16)
    f.anchor('PilotSeat',(-.38,-.45,.84));f.anchor('BoardingPoint',(1.4,.1,.12))
    f.finish('RotorShuttle','four-seat helicopter',{'seats':4,'pilot':'PilotSeat','passengers':['FrontRightOccupant','RearLeftOccupant','RearRightOccupant'],
      'rotors':['MainRotor','TailRotor'],'rotor_axis':'each pivot localZ; TailRotor has fixed localY90degree orientation',
      'doors':['LeftCabinDoor','RightCabinDoor'],'door_axis':'localZ','landing_gear':'two fixed skids with structural support struts','boarding':'BoardingPoint'})

if __name__=='__main__':
    selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    for name,build in [('Bicycle',bicycle),('RotorShuttle',rotor_shuttle)]:
        if not selected or name in selected:build()
    f.write_summary()
