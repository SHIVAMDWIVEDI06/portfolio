"""Minimal glTF 2.0 (.gltf + .bin) loader: flattens all primitives into one
world-space triangle soup with per-vertex normals and colours (from material
baseColorFactor when there is no texture). Enough for a flat-shaded hero mesh."""
import json, struct, os
import numpy as np

CT = {5120:np.int8,5121:np.uint8,5122:np.int16,5123:np.uint16,5125:np.uint32,5126:np.float32}
NC = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def load(path):
    g=json.load(open(path)); base=os.path.dirname(path)
    bufs=[open(os.path.join(base,b['uri']),'rb').read() for b in g['buffers']]
    def acc(i):
        a=g['accessors'][i]; bv=g['bufferViews'][a['bufferView']]
        dt=CT[a['componentType']]; n=NC[a['type']]
        off=bv.get('byteOffset',0)+a.get('byteOffset',0)
        stride=bv.get('byteStride',0)
        cnt=a['count']; item=np.dtype(dt).itemsize*n
        raw=bufs[bv['buffer']]
        if stride and stride!=item:
            out=np.empty((cnt,n),dtype=dt)
            for k in range(cnt):
                out[k]=np.frombuffer(raw,dtype=dt,count=n,offset=off+k*stride)
            arr=out
        else:
            arr=np.frombuffer(raw,dtype=dt,count=cnt*n,offset=off).reshape(cnt,n)
        if a.get('normalized'):
            arr=arr.astype(np.float32)/np.iinfo(dt).max
        return arr

    def node_mat(nd):
        if 'matrix' in nd: return np.array(nd['matrix'],dtype=np.float64).reshape(4,4).T
        T=np.eye(4); R=np.eye(4); S=np.eye(4)
        if 't' in nd or 'translation' in nd:
            t=nd.get('translation',[0,0,0]); T[:3,3]=t
        if 'rotation' in nd:
            x,y,z,w=nd['rotation']
            R[:3,:3]=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                      [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                      [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
        if 'scale' in nd:
            s=nd['scale']; S[0,0],S[1,1],S[2,2]=s
        return T@R@S

    P=[];N=[];C=[];I=[];M=[]; voff=0
    def visit(ni,parent):
        nd=g['nodes'][ni]; m=parent@node_mat(nd)
        if 'mesh' in nd:
            nonlocal voff
            for prim in g['meshes'][nd['mesh']]['primitives']:
                if prim.get('mode',4)!=4: continue
                pos=acc(prim['attributes']['POSITION']).astype(np.float64)
                cnt=len(pos)
                w=(m[:3,:3]@pos.T).T+m[:3,3]
                if 'NORMAL' in prim['attributes']:
                    nr=acc(prim['attributes']['NORMAL']).astype(np.float64)
                    nm=np.linalg.inv(m[:3,:3]).T
                    wn=(nm@nr.T).T
                    wn/=np.linalg.norm(wn,axis=1,keepdims=True)+1e-9
                else:
                    wn=np.zeros_like(w)
                mat=g['materials'][prim['material']] if 'material' in prim else {}
                pbr=mat.get('pbrMetallicRoughness',{})
                bc=pbr.get('baseColorFactor',[0.8,0.8,0.8,1])[:3]
                em=mat.get('emissiveFactor',[0,0,0])
                rough=pbr.get('roughnessFactor',0.6); metal=pbr.get('metallicFactor',0.0)
                col=np.tile(np.array(bc,dtype=np.float32),(cnt,1))
                if 'COLOR_0' in prim['attributes']:
                    vc=acc(prim['attributes']['COLOR_0']).astype(np.float32)
                    col=col*vc[:,:3]
                idx=acc(prim['indices']).astype(np.int64).ravel() if 'indices' in prim else np.arange(cnt)
                P.append(w);N.append(wn);C.append(col);I.append(idx+voff)
                M.append(np.tile(np.array([rough,metal,float(max(em))],dtype=np.float32),(cnt,1)))
                voff+=cnt
        for c in nd.get('children',[]): visit(c,m)
    scene=g['scenes'][g.get('scene',0)]
    for r in scene['nodes']: visit(r,np.eye(4))
    return (np.concatenate(P),np.concatenate(N),np.concatenate(C),np.concatenate(I),np.concatenate(M))
