#!/usr/bin/env python3
"""Original fictional café source geometry. Meters, Y up, storefront faces -Z.
No real building, brand, source mesh or third-party shape is reproduced.
CC0-1.0 applies to this generated original geometry; native visual quality unverified.
"""
import hashlib,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'unity/Assets/HOMELESS/Art/Architecture/FictionalCafe'
class Mesh:
 def __init__(self):self.lines=['# Original fictional HOMELESS café; CC0-1.0','mtllib FictionalCafe.mtl'];self.n=0;self.groups=[];self.triangles=0;self.bounds=[[float('inf')]*3,[float('-inf')]*3]
 def group(self,name,mat):self.lines+=['g '+name,'usemtl '+mat];self.groups.append(name)
 def face(self,points,scale=(1,1),normals=None):
  a,b,c=points[:3];u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)];n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];d=math.sqrt(sum(x*x for x in n));n=[x/d for x in n]
  width=math.dist(a,b)/scale[0];height=math.dist(b,c)/scale[1];uv=[(0,0),(width,0),(width,height),(0,height)]
  for i,p in enumerate(points):
   self.lines.append('v '+' '.join(f'{x:.6f}' for x in p));self.lines.append('vt %.6f %.6f'%uv[i]);self.lines.append('vn '+' '.join(f'{x:.6f}' for x in (normals[i] if normals else n)))
   for axis in range(3):self.bounds[0][axis]=min(self.bounds[0][axis],p[axis]);self.bounds[1][axis]=max(self.bounds[1][axis],p[axis])
  for i in range(1,len(points)-1):self.lines.append('f '+' '.join(f'{self.n+j+1}/{self.n+j+1}/{self.n+j+1}' for j in (0,i,i+1)))
  self.n+=len(points);self.triangles+=len(points)-2
 def box(self,x0,y0,z0,x1,y1,z1,scale=(1,1)):
  for p in [[(x0,y0,z0),(x0,y1,z0),(x1,y1,z0),(x1,y0,z0)],[(x1,y0,z1),(x1,y1,z1),(x0,y1,z1),(x0,y0,z1)],[(x0,y0,z1),(x0,y1,z1),(x0,y1,z0),(x0,y0,z0)],[(x1,y0,z0),(x1,y1,z0),(x1,y1,z1),(x1,y0,z1)],[(x0,y1,z0),(x0,y1,z1),(x1,y1,z1),(x1,y1,z0)],[(x0,y0,z1),(x0,y0,z0),(x1,y0,z0),(x1,y0,z1)]]: self.face(p,scale)
 def cylinder(self,x,y,z,r,height,segments=32):
  for i in range(segments):
   a=i*2*math.pi/segments;b=(i+1)*2*math.pi/segments
   p=[(x+r*math.cos(a),y,z+r*math.sin(a)),(x+r*math.cos(a),y+height,z+r*math.sin(a)),(x+r*math.cos(b),y+height,z+r*math.sin(b)),(x+r*math.cos(b),y,z+r*math.sin(b))]
   self.face(p,normals=[(math.cos(a),0,math.sin(a))]*2+[(math.cos(b),0,math.sin(b))]*2)
   self.face([(x,y+height,z),p[2],p[1]])
   self.face([(x,y,z),p[0],p[3]])

def build():
 m=Mesh()
 m.group('shell_rear_and_sides','Concrete034');m.box(0,0,.18,.22,4,8,(1.1,.55));m.box(11.78,0,.18,12,4,8,(1.1,.55));m.box(.22,0,7.78,11.78,4,8,(1.1,.55))
 m.group('floor','Concrete034');m.box(0,-.18,0,12,0,8,(1.1,.55))
 m.group('front_brick_plinth_and_piers','Bricks059')
 for x0,x1 in [(0,.4),(4.9,5.4),(6.6,7.1),(11.6,12)]:m.box(x0,0,0,x1,3.3,.26,(1.05,1.05))
 for x0,x1 in [(.4,4.9),(7.1,11.6)]:m.box(x0,0,0,x1,.65,.26,(1.05,1.05))
 m.group('fascia','Concrete034');m.box(0,3.05,0,12,3.9,.28,(1.1,.55))
 m.group('roof_with_overhang','Roof');m.box(-.12,3.9,-.12,12.12,4.04,8.12)
 m.group('stepped_cornice','Frame')
 for y,w,d in [(3.68,.04,.34),(3.78,.05,.4),(3.89,.06,.46)]:m.box(-w,y,-d,12+w,y+.06,.28)
 m.group('glazing','Glass')
 for x0,x1 in [(.47,4.83),(7.17,11.53)]:m.face([(x0,.73,.14),(x0,2.96,.14),(x1,2.96,.14),(x1,.73,.14)])
 m.group('window_mullions_sills','Frame')
 for x0,x1 in [(.4,4.9),(7.1,11.6)]:
  for x in [x0,x0+(x1-x0)/3,x0+2*(x1-x0)/3,x1-.05]:m.box(x,.65,-.055,x+.055,3.05,.22)
  for y in [.65,2.5,2.98]:m.box(x0,y,-.055,x1,y+.065,.22)
  m.box(x0-.035,.6,-.16,x1+.035,.67,.31)
 m.group('entrance_frame','Frame')
 for x in [5.36,6.6]:m.box(x,0,-.06,x+.06,3.05,.25)
 m.box(5.36,2.43,-.06,6.66,2.5,.25)
 m.group('entrance_transom','Glass');m.face([(5.44,2.51,.14),(5.44,2.96,.14),(6.58,2.96,.14),(6.58,2.51,.14)])
 # Original separate door mesh, authored in open position about the left hinge.
 old=m.face
 def doorface(points,scale=(1,1),normals=None):
  angle=math.radians(72)
  old([(5.44+(x-5.44)*math.cos(angle)-(z-.13)*math.sin(angle),y,.13+(x-5.44)*math.sin(angle)+(z-.13)*math.cos(angle)) for x,y,z in points],scale)
 m.face=doorface;m.group('door_leaf_open_static','Frame')
 for x in [5.44,6.5]:m.box(x,0,.09,x+.06,2.41,.17)
 for y in [0,.18,2.34]:m.box(5.44,y,.09,6.56,y+.07,.17)
 m.group('door_glass','Glass');m.face([(5.5,.26,.13),(5.5,2.32,.13),(6.5,2.32,.13),(6.5,.26,.13)])
 m.group('door_pull','Metal');m.box(6.35,.9,.01,6.38,1.3,.04);m.face=old
 # Curved striped fabric canopy; each 12-degree segment is original explicit geometry.
 for strip in range(24):
  m.group(f'awning_stripe_{strip:02d}','AwningLight' if strip%2==0 else 'AwningDark')
  x0=.15+strip*11.7/24;x1=x0+11.7/24
  for k in range(8):
   a=k*math.pi/16;b=(k+1)*math.pi/16
   m.face([(x0,2.72+.64*math.cos(a),-.05-.9*math.sin(a)),(x0,2.72+.64*math.cos(b),-.05-.9*math.sin(b)),(x1,2.72+.64*math.cos(b),-.05-.9*math.sin(b)),(x1,2.72+.64*math.cos(a),-.05-.9*math.sin(a))])
  m.box(x0,2.55,-.96,x1,2.73,-.92)
 m.group('awning_supports','Metal')
 for x in [.3,5.2,6.8,11.7]:m.box(x,2.7,-.9,x+.025,2.73,.08)
 m.group('service_counter','Wood');m.box(8.9,0,5.5,11.25,1.02,6.25);m.box(8.84,1.02,5.44,11.31,1.09,6.31)
 m.group('counter_panel_recesses','Frame')
 for x in [9.05,9.7,10.35]:m.box(x,.12,5.46,x+.48,.87,5.5)
 for index,(x,z) in enumerate([(2,2.7),(4.1,5.5),(7.9,2.8)]):
  m.group(f'table_{index}_top','Wood');m.cylinder(x,.73,z,.55,.055,48)
  m.group(f'table_{index}_pedestal','Metal');m.cylinder(x,.04,z,.055,.69);m.cylinder(x,.015,z,.29,.035)
  for side in [-1,1]:
   cx=x+side*.86;m.group(f'chair_{index}_{side}_seat','Wood');m.cylinder(cx,.43,z,.23,.035)
   m.group(f'chair_{index}_{side}_frame','Metal')
   for dx in [-.15,.15]:
    for dz in [-.15,.15]:m.cylinder(cx+dx,0,z+dz,.016,.43,12)
   for dz in [-.18,.18]:m.cylinder(cx+side*.18,.43,z+dz,.016,.45,12)
   m.box(cx+side*.18-.025,.75,z-.2,cx+side*.18+.025,.88,z+.2)
 for i,x in enumerate([2,6,10]):
  m.group(f'pendant_{i}','Metal');m.cylinder(x,3.1,4,.012,.78,12);m.cylinder(x,2.98,4,.19,.12,32)
  m.group(f'pendant_{i}_diffuser','Lamp');m.cylinder(x,2.96,4,.175,.018,32)
 m.group('sidewalk_scored_slabs','Concrete034')
 for x in range(-1,13):
  for z in range(-3,0):m.box(x+.008,-.16,z+.008,x+.992,-.015,z+.992,(1.1,.55))
 m.group('segmented_curb','Concrete034')
 for x in range(-1,13):m.box(x+.008,-.31,-3.19,x+.992,-.015,-3.01,(1.1,.55))
 m.group('drain_surround','Metal');m.box(10.45,-.25,-3.72,11.15,-.21,-3.22)
 m.group('drain_grate','Frame')
 for i in range(12):m.box(10.46+i*.057,-.21,-3.71,10.48+i*.057,-.195,-3.23)
 OUT.mkdir(parents=True,exist_ok=True)
 obj=OUT/'FictionalCafe.obj';obj.write_text('\n'.join(m.lines)+'\n')
 mats={'Bricks059':(.55,.23,.14),'Concrete034':(.7,.7,.65),'Frame':(.055,.075,.07),'Glass':(.65,.82,.86),'Roof':(.16,.18,.17),'Metal':(.18,.2,.19),'Wood':(.28,.14,.065),'AwningLight':(.88,.82,.66),'AwningDark':(.1,.24,.2),'Lamp':(.95,.8,.5)}
 lines=['# Original material descriptions; ambientCG texture links retain CC0 rights']
 for name,col in mats.items():
  lines+=['newmtl '+name,'Kd '+' '.join(map(str,col)),'Ks 0.04 0.04 0.04','Ns 32','d '+('0.22' if name=='Glass' else '1.0')]
  if name in ['Bricks059','Concrete034']:lines.append('map_Kd ../../Materials/'+name+'/'+name+'_2K-JPG_Color.jpg')
 mtl=OUT/'FictionalCafe.mtl';mtl.write_text('\n'.join(lines)+'\n')
 report=dict(id='FictionalCafe',fictional=True,units='meters',up_axis='Y',front_direction='-Z',bounds_m=m.bounds,triangles=m.triangles,vertices=m.n,groups=m.groups,material_slots=list(mats),lods='LOD0 source only; lower LODs not authored',collision='NOT_RUN: separate collider/navigation pass needed; never auto-collide transparent panes/awning as walkable surfaces',door='Distinct group in open static position; no rig or interaction claimed',source_recipe='tools/art/author_cafe.py',sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [obj,mtl]},unity_imported=False,android_rendered=False,world_integrated=False,quality='UNVERIFIED; detailed original geometry does not certify cinematic acceptance')
 (OUT/'geometry.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['triangles','vertices','bounds_m','sha256']}))
if __name__=='__main__':build()
