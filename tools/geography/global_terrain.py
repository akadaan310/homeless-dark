#!/usr/bin/env python3
"""Decode pinned GEBCO overview relief, expose bounded mean-sea-level height lookup."""
import argparse
import array
import ctypes as C
import ctypes.util
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import urllib.request
from global_layers import DEST, atomic, canonical, digest

URL='https://oceania.generic-mapping-tools.org/server/earth/earth_gebco/earth_gebco_06m_g.grd'
CITATION='GEBCO Compilation Group (2025), GEBCO 2025 Grid, doi:10.5285/37c52e96-24ea-67ce-e063-7086abc05f29; Gaussian-filtered 6 arcminute derivative by GMT.'


def scalar_attribute(lib,ncid,var,name,default):
    """netCDF copies every attribute element; reject vectors before passing scalar storage."""
    length=C.c_size_t()
    code=lib.nc_inq_attlen(ncid,var,name.encode(),C.byref(length))
    if code==-43:return default  # NC_ENOTATT; other errors are not missing data.
    if code!=0 or length.value!=1:raise ValueError('expected scalar netCDF attribute '+name)
    value=C.c_double()
    if lib.nc_get_att_double(ncid,var,name.encode(),C.byref(value))!=0 or not math.isfinite(value.value):
        raise ValueError('invalid numeric netCDF attribute '+name)
    return value.value


def decode(path):
    libpath=ctypes.util.find_library('netcdf')
    if not libpath:raise RuntimeError('libnetcdf required only for reproduction, not runtime lookup')
    lib=C.CDLL(libpath)
    signatures={'nc_open':([C.c_char_p,C.c_int,C.POINTER(C.c_int)],C.c_int),'nc_close':([C.c_int],C.c_int),
      'nc_inq_varid':([C.c_int,C.c_char_p,C.POINTER(C.c_int)],C.c_int),
      'nc_inq_var':([C.c_int,C.c_int,C.c_char_p,C.POINTER(C.c_int),C.POINTER(C.c_int),C.POINTER(C.c_int),C.POINTER(C.c_int)],C.c_int),
      'nc_inq_dimlen':([C.c_int,C.c_int,C.POINTER(C.c_size_t)],C.c_int),
      'nc_get_var_short':([C.c_int,C.c_int,C.POINTER(C.c_short)],C.c_int),
      'nc_get_var_double':([C.c_int,C.c_int,C.POINTER(C.c_double)],C.c_int),
      'nc_get_att_double':([C.c_int,C.c_int,C.c_char_p,C.POINTER(C.c_double)],C.c_int),
      'nc_inq_attlen':([C.c_int,C.c_int,C.c_char_p,C.POINTER(C.c_size_t)],C.c_int),
      'nc_get_att_text':([C.c_int,C.c_int,C.c_char_p,C.c_char_p],C.c_int)}
    for name,(args,restype) in signatures.items():fn=getattr(lib,name);fn.argtypes=args;fn.restype=restype
    def check(code):
        if code!=0:raise ValueError('netCDF error '+str(code))
    ncid=C.c_int();check(lib.nc_open(str(path).encode(),0,C.byref(ncid)))
    try:
        def var(name):
            v=C.c_int();check(lib.nc_inq_varid(ncid,name.encode(),C.byref(v)));return v.value
        def shape(v):
            xtype=C.c_int();nd=C.c_int();dims=(C.c_int*1024)();atts=C.c_int()
            check(lib.nc_inq_var(ncid,v,None,C.byref(xtype),C.byref(nd),dims,C.byref(atts)))
            if nd.value>2:raise ValueError('unexpected grid dimensions')
            values=[]
            for i in range(nd.value):
                n=C.c_size_t();check(lib.nc_inq_dimlen(ncid,dims[i],C.byref(n)));values.append(n.value)
            return xtype.value,values
        def text_attr(v,name):
            n=C.c_size_t()
            if lib.nc_inq_attlen(ncid,v,name.encode(),C.byref(n))!=0:return None
            if n.value>16384:raise ValueError('attribute bound')
            data=C.create_string_buffer(n.value+1);check(lib.nc_get_att_text(ncid,v,name.encode(),data));return data.value.decode('utf-8')
        z=var('z');xtype,dimensions=shape(z)
        if xtype!=3 or dimensions!=[1801,3601]:raise ValueError('unexpected source grid layout')
        ny,nx=dimensions
        coordinates={}
        for name,n in [('lat',ny),('lon',nx)]:
            v=var(name)
            if shape(v)[1]!=[n]:raise ValueError('coordinate shape')
            values=(C.c_double*n)();check(lib.nc_get_var_double(ncid,v,values));coordinates[name]=list(values)
        for name,start,step in [('lat',-90,.1),('lon',-180,.1)]:
            if any(abs(v-(start+i*step))>1e-9 for i,v in enumerate(coordinates[name])):raise ValueError('nonuniform or reversed source grid')
        scale=scalar_attribute(lib,ncid,z,'scale_factor',1);offset=scalar_attribute(lib,ncid,z,'add_offset',0)
        fill=scalar_attribute(lib,ncid,z,'_FillValue',-32768)
        if scale<=0 or not -32768<=fill<=32767 or fill!=int(fill):raise ValueError('invalid relief scale or int16 fill value')
        values=(C.c_short*(nx*ny))();check(lib.nc_get_var_short(ncid,z,values))
        if any(v==fill for v in values):raise ValueError('source grid contains nodata')
        data=bytes(values)
        if sys.byteorder!='little':
            a=array.array('h');a.frombytes(data);a.byteswap();data=a.tobytes()
        return data,{'width':nx,'height':ny,'west':-180,'south':-90,'step_degrees':.1,'scale_factor':scale,'add_offset':offset,
           'registration':'gridline','ordering':'south-to-north rows, west-to-east columns, little-endian int16',
           'min_height_m':min(values)*scale+offset,'max_height_m':max(values)*scale+offset,
           'source_title':text_attr(-1,'title'),'source_description':text_attr(-1,'description'),
           'source_history':text_attr(-1,'history'),'source_z_units':text_attr(z,'units')}
    finally:check(lib.nc_close(ncid))


def reproduce(dest=DEST/'terrain'):
    dest=Path(dest);lock=json.loads((dest/'source.lock.json').read_bytes());path=dest/'earth_gebco_06m_g.grd'
    if digest(path)!=lock['sha256'] or path.stat().st_size!=lock['bytes']:raise ValueError('terrain source integrity')
    data,grid=decode(path)
    atomic(dest/'heights.i16',data)
    report={'schema':'dark.global-terrain/1','source':lock,'grid':grid,'height_datum':'mean sea level approximation; source mixes heterogeneous datums; not WGS84 ellipsoidal height',
       'horizontal_crs':'geographic longitude/latitude WGS84','gaussian_full_width_km':32,'coverage':'complete global grid, including poles and ocean bathymetry',
       'native_collision_ready':False,'street_scale_precision':False,
       'runtime_file':{'path':'heights.i16','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()},
       'limitations':['6 arcminute (~11 km latitude spacing) overview with Gaussian smoothing; no road-level or building-level accuracy.',
         'Sea-floor elevation is not water-surface elevation. Never use for navigation or safety at sea.',
         'Sampling interpolates the overview; it does not invent higher resolution. Geoid conversion is not included.']}
    atomic(dest/'metadata.json',canonical(report));return report


def acquire(dest=DEST/'terrain'):
    dest=Path(dest)
    with urllib.request.urlopen(URL,timeout=60) as r:
        if r.status!=200:raise ValueError('terrain HTTP status')
        data=r.read(16*1024*1024+1)
    if len(data)>16*1024*1024 or data[:8]!=b'\x89HDF\r\n\x1a\n':raise ValueError('invalid or oversized netCDF4 response')
    atomic(dest/'earth_gebco_06m_g.grd',data)
    atomic(dest/'source.lock.json',canonical({'url':URL,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'acquired':'2026-10-21','release':'GEBCO_2025, GMT derivative 2025-08-12',
        'license':'Public domain; source acknowledgment and non-misrepresentation terms', 'license_url':'https://www.gebco.net/data-products/gridded-bathymetry/terms-of-use',
        'citation':CITATION,'processing_reference':'https://www.generic-mapping-tools.org/remote-datasets/earth-gebco.html'}))
    return reproduce(dest)


class Terrain:
    def __init__(self,dest=DEST/'terrain'):
        self.dest=Path(dest);self.meta=json.loads((self.dest/'metadata.json').read_bytes());self.grid=self.meta['grid']
        grid=self.grid
        if (self.meta.get('schema')!='dark.global-terrain/1' or type(grid.get('width')) is not int or type(grid.get('height')) is not int
            or (grid['width'],grid['height'])!=(3601,1801) or grid.get('step_degrees')!=.1 or grid.get('west')!=-180 or grid.get('south')!=-90
            or grid.get('registration')!='gridline' or self.meta['runtime_file'].get('path')!='heights.i16'
            or self.meta['runtime_file'].get('bytes')!=2*3601*1801):raise ValueError('invalid terrain runtime layout')
        for name in ('scale_factor','add_offset','min_height_m','max_height_m'):
            value=grid.get(name)
            if isinstance(value,bool) or not isinstance(value,(float,int)) or not math.isfinite(value):raise ValueError('invalid terrain numeric metadata')
        if grid['scale_factor']<=0 or grid['min_height_m']>grid['max_height_m']:raise ValueError('invalid terrain scale or range')
        path=self.dest/self.meta['runtime_file']['path']
        if path.stat().st_size!=self.meta['runtime_file']['bytes'] or digest(path)!=self.meta['runtime_file']['sha256']:raise ValueError('terrain runtime integrity')
        self.path=path
    def height(self,lat,lon):
        if any(isinstance(v,bool) or not isinstance(v,(float,int)) or not math.isfinite(v) for v in (lat,lon)) or not -90<=lat<=90 or not -180<=lon<=180:raise ValueError('invalid WGS84 coordinate')
        if lon==180:lon=-180
        if abs(lat)==90:lon=0
        width,height=self.grid['width'],self.grid['height'];step=self.grid['step_degrees']
        x=(lon+180)/step;y=(lat+90)/step
        ix=min(width-2,max(0,int(math.floor(x))));iy=min(height-2,max(0,int(math.floor(y))))
        fx=x-ix;fy=y-iy
        with self.path.open('rb') as f:
            f.seek(2*(iy*width+ix));a,b=struct.unpack('<hh',f.read(4))
            f.seek(2*((iy+1)*width+ix));c,d=struct.unpack('<hh',f.read(4))
        raw=(a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy
        return {'latitude':lat,'longitude':lon,'height_m_msl':raw*self.grid['scale_factor']+self.grid['add_offset'],
                'sample_spacing_degrees':step,'datum':self.meta['height_datum'],'native_collision_ready':False,
                'source_sha256':self.meta['source']['sha256']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['acquire','reproduce','height']);parser.add_argument('--lat',type=float);parser.add_argument('--lon',type=float)
    args=parser.parse_args();print(json.dumps(Terrain().height(args.lat,args.lon) if args.command=='height' else acquire() if args.command=='acquire' else reproduce(),indent=2))
