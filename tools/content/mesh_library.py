"""Original fictional unbranded sedan source, Blender 3.0+.
All geometry authored here; detailed source art with functional sub-object pivots.
No native physics, visual quality, trademark likeness or driving approval claimed.
"""
import bpy, math, json, pathlib
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2]




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

