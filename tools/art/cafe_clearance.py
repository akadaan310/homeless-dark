#!/usr/bin/env python3
"""Derive conservative pedestrian XZ footprints from the actual café recipe.

The generated Unity scene translates the source by (+8,0,+2.5) metres.
These source-derived rectangles are admission broad phase, not measured native
collision. Doors are currently authored open; this does not invent a door rig.
"""
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile

ROOT=Path(__file__).resolve().parents[2]


def derive():
    path=ROOT/'tools/art/author_cafe.py'
    spec=importlib.util.spec_from_file_location('cafe_geometry_for_clearance',path)
    author=importlib.util.module_from_spec(spec);spec.loader.exec_module(author)
    Base=author.Mesh;rectangles=[]
    class TracedMesh(Base):
        def __init__(self):super().__init__();self.collected=None
        def record(self,points):
            lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
            if hi[1]<.1 or lo[1]>1.8:return
            # AABB of one source primitive, including transformed door geometry;
            # grouping all shell faces would incorrectly block the whole interior.
            x0,z0,x1,z1=lo[0]+8,lo[2]+2.5,hi[0]+8,hi[2]+2.5
            if x1-x0<.01:x0-=.005;x1+=.005
            if z1-z0<.01:z0-=.005;z1+=.005
            rectangles.append({'group':self.groups[-1],'bounds':[round(v,6) for v in (x0,z0,x1,z1)]})
        def face(self,points,scale=(1,1),normals=None):
            if self.collected is not None:self.collected.extend(points)
            elif self.groups[-1]=='door_glass':self.record(points)
            return super().face(points,scale,normals)
        def box(self,*args,**kwargs):
            self.collected=[];super().box(*args,**kwargs);self.record(self.collected);self.collected=None
        def cylinder(self,*args,**kwargs):
            self.collected=[];super().cylinder(*args,**kwargs);self.record(self.collected);self.collected=None
    author.Mesh=TracedMesh
    with tempfile.TemporaryDirectory(prefix='dark-cafe-clearance-') as tmp:
        author.OUT=Path(tmp)
        with redirect_stdout(io.StringIO()):author.build()
        geometry_hash=hashlib.sha256((Path(tmp)/'FictionalCafe.obj').read_bytes()).hexdigest()
    # Exact redundant rectangles are removed; component relationships remain.
    unique=[];seen=set()
    for r in rectangles:
        key=tuple(r['bounds'])
        if key not in seen:seen.add(key);unique.append(r)
    if len(unique)>128:raise ValueError('authored region blocker budget exceeded')
    return {'schema':'dark.cafe-clearance/1','recipe_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'geometry_sha256':geometry_hash,'translation_m':[8,0,2.5],
            'body_vertical_interval_m':[.1,1.8],'pedestrian_radius_applied_by_authority_m':.3,
            'rectangles':unique,'approximation':'conservative AABBs per source box/cylinder; door transformed before projection',
            'native_collision_validation':'NOT_RUN'}


if __name__=='__main__':
    out=ROOT/'assets/content/world/cafe-clearance.json';out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(derive(),indent=2)+'\n');print(out.relative_to(ROOT))
